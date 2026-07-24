import { mkdir, rm, writeFile } from "fs/promises";
import { configureGitAuth } from "../../github/operations/git-config";
import { checkHumanActor } from "../../github/validation/actor";
import { isEntityContext } from "../../github/context";
import type { GitHubContext, PrepareResult } from "../../github/types";
import type { Octokits } from "../../github/api/client";

/**
 * Prepares agent mode execution context.
 *
 * Agent mode runs when an explicit prompt is provided in the workflow config.
 * No tracking comments — direct execution.
 */
export async function prepareAgentMode({
  context,
  octokit,
  githubToken,
}: {
  context: GitHubContext;
  octokit: Octokits;
  githubToken: string;
}): Promise<PrepareResult> {
  // Validate actor
  if (isEntityContext(context)) {
    await checkHumanActor(octokit.rest, context);
  }

  // Configure git auth
  const user = {
    login: context.inputs.botName,
    id: parseInt(context.inputs.botId),
  };
  if (isEntityContext(context)) {
    try {
      await configureGitAuth(githubToken, context, user);
    } catch (error) {
      console.error("Failed to configure git authentication:", error);
    }
  }

  // Create prompt directory
  const promptDir = `${process.env.RUNNER_TEMP || "/tmp"}/pi-prompts`;
  await rm(promptDir, { recursive: true, force: true });
  await mkdir(promptDir, { recursive: true });

  // Write prompt file
  const promptContent =
    context.inputs.prompt ||
    `Repository: ${context.repository.owner}/${context.repository.repo}`;
  await writeFile(`${promptDir}/pi-prompt.txt`, promptContent);

  // Detect branches
  const defaultBranch = context.repository.default_branch || "main";
  const baseBranch = context.inputs.baseBranch || defaultBranch;
  const currentBranch =
    process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || defaultBranch;

  // Build Pi CLI args for agent mode
  let piArgs = "";

  // Set model and provider
  piArgs += `--provider ${context.inputs.piProvider}`;
  piArgs += ` --model ${context.inputs.piModel}`;

  // Set thinking level
  if (context.inputs.piThinkingLevel !== "off") {
    piArgs += ` --thinking ${context.inputs.piThinkingLevel}`;
  }

  // Tools
  if (context.inputs.piTools) {
    piArgs += ` --tools ${context.inputs.piTools}`;
  }

  // Extensions
  if (context.inputs.piExtensions) {
    const extensions = context.inputs.piExtensions.split("\n").filter(Boolean);
    for (const ext of extensions) {
      piArgs += ` -e ${ext.trim()}`;
    }
  }

  // Additional user args
  const userArgs = process.env.PI_ARGS || "";
  if (userArgs) {
    piArgs += ` ${userArgs}`;
  }

  // Disable interactivity
  piArgs += " --no-session --approve";

  return {
    commentId: undefined,
    branchInfo: {
      baseBranch,
      currentBranch,
      claudeBranch: undefined,
    },
    piArgs: piArgs.trim(),
  };
}
