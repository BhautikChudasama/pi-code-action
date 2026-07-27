#!/usr/bin/env bun

/**
 * Unified entrypoint for the Pi Code Action.
 * Orchestrates: prepare → install Shelly CLI → execute Pi → cleanup.
 */

import * as core from "@actions/core";
import { dirname } from "path";
import { spawn, execSync } from "child_process";
import { appendFile, mkdir, writeFile } from "fs/promises";
import { readFileSync } from "fs";
import { setupGitHubToken } from "../github/token";
import { checkWritePermissions } from "../github/validation/permissions";
import { createOctokit } from "../github/api/client";
import type { Octokits } from "../github/api/client";
import { parseGitHubContext, isEntityContext } from "../github/context";
import type { GitHubContext, EntityContext } from "../github/types";
import { detectMode } from "../modes/detector";
import { prepareTagMode } from "../modes/tag";
import { prepareAgentMode } from "../modes/agent";
import { checkContainsTrigger } from "../github/validation/trigger";
import { updateTrackingComment } from "../github/operations/comments/update-comment";

/**
 * Write ~/.pi/agent/models.json to register a custom OpenAI-compatible provider.
 * Pi reads this file at startup to discover custom models and base URLs.
 */
async function setupCustomProvider(): Promise<string | undefined> {
  const baseUrl = process.env.PI_BASE_URL;
  if (!baseUrl) return undefined;

  const provider = process.env.PI_PROVIDER || "openai";
  const model = process.env.PI_MODEL || "gpt-4o";
  const apiKey = process.env.PI_API_KEY;

  const modelsConfig = {
    providers: {
      [provider]: {
        baseUrl,
        api: "openai-completions",
        ...(apiKey ? { apiKey } : {}),
        models: [
          {
            id: model,
            name: model,
            input: ["text"],
            contextWindow: 128000,
            maxTokens: 16384,
          },
        ],
      },
    },
  };

  const piDir = `${process.env.HOME}/.pi/agent`;
  await mkdir(piDir, { recursive: true });
  const modelsPath = `${piDir}/models.json`;
  await writeFile(modelsPath, JSON.stringify(modelsConfig, null, 2));
  console.log(`Wrote custom provider config to ${modelsPath}`);
  console.log(`  Provider: ${provider}, Model: ${model}, Base URL: ${baseUrl}`);

  return provider;
}

/**
 * Build the install command for Shelly CLI.
 */
export function buildInstallCommand(): string {
  return `set -o pipefail; curl -fsSL https://pi.dev/install.sh | sh`;
}

/**
 * Install Shelly CLI with retry logic.
 * Returns the path to the pi executable.
 */
async function installPi(): Promise<string> {
  const customExecutable = process.env.PATH_TO_PI_EXECUTABLE;
  if (customExecutable) {
    if (/[\x00-\x1f\x7f]/.test(customExecutable)) {
      throw new Error("PATH_TO_PI_EXECUTABLE contains control characters");
    }
    console.log(`Using custom Shelly executable: ${customExecutable}`);
    const piDir = dirname(customExecutable);
    const githubPath = process.env.GITHUB_PATH;
    if (githubPath) {
      await appendFile(githubPath, `${piDir}\n`);
    }
    process.env.PATH = `${piDir}:${process.env.PATH}`;
    return customExecutable;
  }

  console.log("Installing Shelly CLI...");

  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`Installation attempt ${attempt}...`);
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn("bash", ["-c", buildInstallCommand()], {
          stdio: "inherit",
        });
        child.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Install failed with exit code ${code}`));
        });
        child.on("error", reject);
      });
      console.log("Shelly CLI installed successfully");

      // Pi installs via npm install -g, so find the actual binary location
      // Try: npm global bin, then common paths, then `which`
      let piPath: string | undefined;
      try {
        const npmBin = execSync("npm prefix -g", { encoding: "utf-8" }).trim() + "/bin";
        piPath = `${npmBin}/pi`;
        const githubPath = process.env.GITHUB_PATH;
        if (githubPath) {
          await appendFile(githubPath, `${npmBin}\n`);
        }
        process.env.PATH = `${npmBin}:${process.env.PATH}`;
      } catch {
        // Fallback: use `which` to find pi
        try {
          piPath = execSync("which pi", { encoding: "utf-8" }).trim();
        } catch {
          piPath = "pi"; // Hope it's on PATH
        }
      }
      console.log(`Shelly executable: ${piPath}`);
      return piPath;
    } catch (error) {
      if (attempt === 3) {
        throw new Error(`Failed to install Shelly CLI after 3 attempts: ${error}`);
      }
      console.log("Installation failed, retrying...");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  throw new Error("unreachable");
}

/**
 * Run Shelly CLI with the given prompt file and arguments.
 */
async function runPi(
  piExecutable: string,
  promptFile: string,
  piArgs: string,
): Promise<{ success: boolean; outputFile?: string }> {
  const outputFile = `${process.env.RUNNER_TEMP || "/tmp"}/shelly-output.json`;

  // Build the command: pi -p @promptFile --mode json <args>
  const cmd = `${piExecutable} -p @${promptFile} --mode json ${piArgs} 2>&1 | tee ${outputFile}`;

  console.log(`Running Pi: ${cmd}`);

  return new Promise((resolve) => {
    const piEnv: Record<string, string | undefined> = {
      ...process.env,
      // Disable telemetry and update checks in CI
      PI_TELEMETRY: "0",
      PI_SKIP_VERSION_CHECK: "1",
    };

    // Forward provider API key to the correct env var Pi expects
    const apiKey = process.env.PI_API_KEY;
    const provider = process.env.PI_PROVIDER || "openai";
    if (apiKey) {
      // Set provider-specific env vars Pi reads natively
      piEnv.OPENAI_API_KEY = apiKey;
      piEnv.ANTHROPIC_API_KEY = apiKey;
      piEnv.GOOGLE_API_KEY = apiKey;
      piEnv.DEEPSEEK_API_KEY = apiKey;
    }

    // Forward base URL for OpenAI-compatible endpoints
    const baseUrl = process.env.PI_BASE_URL;
    if (baseUrl) {
      piEnv.OPENAI_BASE_URL = baseUrl;
    }

    const child = spawn("bash", ["-c", cmd], {
      stdio: "inherit",
      env: piEnv,
    });

    child.on("close", (code) => {
      resolve({
        success: code === 0,
        outputFile,
      });
    });

    child.on("error", (error) => {
      console.error(`Shelly process error: ${error}`);
      resolve({ success: false, outputFile });
    });
  });
}

async function run() {
  let githubToken: string | undefined;
  let commentId: number | undefined;
  let claudeBranch: string | undefined;
  let baseBranch: string | undefined;
  let piSuccess = false;
  let prepareCompleted = false;
  let prepareError: string | undefined;
  let context: GitHubContext | undefined;
  let octokit: Octokits | undefined;
  let isPullRequestReviewComment = false;
  const startTimeMs = Date.now();

  try {
    // Phase 1: Prepare
    context = parseGitHubContext();
    const modeName = detectMode(context);
    console.log(`Auto-detected mode: ${modeName} for event: ${context.eventName}`);

    githubToken = await setupGitHubToken();
    octokit = createOctokit(githubToken);

    // Set tokens in env for downstream usage
    process.env.GITHUB_TOKEN = githubToken;
    process.env.GH_TOKEN = githubToken;

    // Check write permissions
    if (isEntityContext(context)) {
      const hasWrite = await checkWritePermissions(octokit.rest, context);
      if (!hasWrite) {
        throw new Error("Actor does not have write permissions to the repository");
      }
    }

    // Check trigger conditions
    const containsTrigger =
      modeName === "tag"
        ? isEntityContext(context) && checkContainsTrigger(context)
        : !!context.inputs?.prompt;

    console.log(`Mode: ${modeName}, Trigger: ${containsTrigger}`);

    if (!containsTrigger) {
      console.log("No trigger found, skipping");
      core.setOutput("github_token", githubToken);
      return;
    }

    // Run prepare
    const prepareResult =
      modeName === "tag"
        ? await prepareTagMode({ context, octokit, githubToken })
        : await prepareAgentMode({ context, octokit, githubToken });

    commentId = prepareResult.commentId;
    claudeBranch = prepareResult.branchInfo.claudeBranch;
    baseBranch = prepareResult.branchInfo.baseBranch;
    isPullRequestReviewComment = prepareResult.isPullRequestReviewComment || false;
    prepareCompleted = true;

    // Phase 2: Install Shelly CLI
    const piExecutable = await installPi();

    // Phase 2.5: Setup custom provider if base_url is provided
    await setupCustomProvider();

    // Phase 3: Run Pi
    const promptFile = `${process.env.RUNNER_TEMP || "/tmp"}/shelly-prompts/shelly-prompt.txt`;

    const result = await runPi(piExecutable, promptFile, prepareResult.piArgs);
    piSuccess = result.success;

    if (result.outputFile) {
      core.setOutput("execution_file", result.outputFile);
    }
    core.setOutput("branch_name", claudeBranch);
    core.setOutput("github_token", githubToken);

    if (!piSuccess) {
      core.setFailed("Shelly execution failed");
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (!prepareCompleted) {
      prepareError = errorMessage;
    }
    core.setFailed(`Action failed: ${errorMessage}`);
  } finally {
    // Phase 4: Cleanup — update tracking comment
    if (
      commentId &&
      context &&
      isEntityContext(context) &&
      githubToken &&
      octokit
    ) {
      try {
        let executionOutput: string | undefined;
        const outputFile = `${process.env.RUNNER_TEMP || "/tmp"}/shelly-output.json`;
        try {
          executionOutput = readFileSync(outputFile, "utf-8");
        } catch {
          // No output file
        }

        await updateTrackingComment({
          commentId,
          context,
          octokit: octokit.rest,
          success: piSuccess,
          branchName: claudeBranch,
          baseBranch: baseBranch || "main",
          error: prepareError,
          executionOutput,
          startTimeMs,
          isPullRequestReviewComment,
        });
      } catch (error) {
        console.error("Error updating tracking comment:", error);
      }
    }

    core.setOutput("branch_name", claudeBranch);
    core.setOutput("github_token", githubToken);
  }
}

if (import.meta.main) {
  run();
}
