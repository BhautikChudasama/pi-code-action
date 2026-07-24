import { mkdir, rm, writeFile } from "fs/promises";
import { formatGitHubDataAsPrompt } from "../github/data/formatter";
import { extractUserRequest } from "../github/data/fetcher";
import type { GitHubData, EntityContext } from "../github/types";

/**
 * Create the prompt file for Pi.
 *
 * Combines:
 * - The user's request (extracted from trigger comment)
 * - Full GitHub context (issue/PR body, comments, diff)
 * - Branch information
 * - Instructions for Pi
 */
export async function createPrompt(
  commentId: number,
  baseBranch: string,
  workingBranch: string | undefined,
  githubData: GitHubData,
  context: EntityContext,
): Promise<string> {
  const promptDir = `${process.env.RUNNER_TEMP || "/tmp"}/pi-prompts`;
  await rm(promptDir, { recursive: true, force: true });
  await mkdir(promptDir, { recursive: true });

  const promptPath = `${promptDir}/pi-prompt.txt`;

  const sections: string[] = [];

  // System context
  sections.push("# Context");
  sections.push("");
  sections.push(
    `You are Pi, running as a GitHub Action on repository ${context.repository.owner}/${context.repository.repo}.`,
  );
  sections.push(`You are working on branch: ${workingBranch || baseBranch}`);
  sections.push(`Base branch: ${baseBranch}`);
  sections.push("");

  // Instructions
  sections.push("# Instructions");
  sections.push("");
  sections.push("- Read the GitHub context below carefully.");
  sections.push("- Understand what the user is asking for.");
  sections.push("- Make the necessary code changes.");
  sections.push("- Commit and push your changes to the working branch.");
  sections.push(
    "- If you create a new branch with changes, push it so the user can review.",
  );
  sections.push("");

  // User request
  const triggerPhrase = context.inputs.triggerPhrase;
  const commentBody = context.comment?.body || "";
  const userRequest = extractUserRequest(triggerPhrase, commentBody);

  if (userRequest) {
    sections.push("# User Request");
    sections.push("");
    sections.push(userRequest);
    sections.push("");
  }

  // GitHub data
  const githubContext = formatGitHubDataAsPrompt(githubData);
  sections.push(githubContext);

  const prompt = sections.join("\n");
  await writeFile(promptPath, prompt);

  return promptPath;
}
