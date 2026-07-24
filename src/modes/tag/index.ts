import { checkHumanActor } from "../../github/validation/actor";
import { createInitialComment } from "../../github/operations/comments/create-initial";
import { setupBranch } from "../../github/operations/branch";
import { configureGitAuth } from "../../github/operations/git-config";
import { fetchGitHubData } from "../../github/data/fetcher";
import { createPrompt } from "../../create-prompt";
import { isEntityContext } from "../../github/context";
import type { GitHubContext, PrepareResult } from "../../github/types";
import type { Octokits } from "../../github/api/client";

/**
 * Prepares tag mode execution context.
 *
 * Tag mode responds to @pi mentions, issue assignments, or labels.
 * Creates tracking comments and has full implementation capabilities.
 */
export async function prepareTagMode({
  context,
  octokit,
  githubToken,
}: {
  context: GitHubContext;
  octokit: Octokits;
  githubToken: string;
}): Promise<PrepareResult> {
  if (!isEntityContext(context)) {
    throw new Error("Tag mode requires entity context");
  }

  // Validate actor
  await checkHumanActor(octokit.rest, context);

  // Create tracking comment
  const commentData = await createInitialComment(octokit.rest, context);
  const commentId = commentData.id;

  // Fetch GitHub data
  const githubData = await fetchGitHubData({
    octokits: octokit,
    repository: `${context.repository.owner}/${context.repository.repo}`,
    issueOrPrNumber: context.entityNumber.toString(),
    isPR: context.isPR,
    triggerUsername: context.actor,
  });

  // Setup branch
  const branchInfo = await setupBranch(octokit, githubData, context);

  // Configure git auth
  const user = {
    login: context.inputs.botName,
    id: parseInt(context.inputs.botId),
  };
  await configureGitAuth(githubToken, context, user);

  // Create prompt file
  await createPrompt(
    commentId,
    branchInfo.baseBranch,
    branchInfo.claudeBranch,
    githubData,
    context,
  );

  // Build Pi CLI args for tag mode
  // Include built-in tools AND our custom extension tools
  const tagModeTools = [
    "read", "bash", "edit", "write", "grep", "find", "ls",
    "update_tracking_comment",
    "get_ci_status",
    "create_inline_comment",
  ];
  let piArgs = "";

  // Load our GitHub tools extension
  const extensionPath = `${process.env.GITHUB_ACTION_PATH}/extensions/github-tools.ts`;
  piArgs += ` -e ${extensionPath}`;

  // Set env vars for the extension
  process.env.REPO_OWNER = context.repository.owner;
  process.env.REPO_NAME = context.repository.repo;
  process.env.PI_COMMENT_ID = commentId.toString();
  process.env.IS_PR_REVIEW_COMMENT = commentData.isPullRequestReviewComment ? "true" : "false";
  if (context.isPR) {
    process.env.PR_NUMBER = context.entityNumber.toString();
  }

  // Set tools (must include extension tools or they get blocked)
  piArgs += ` --tools ${tagModeTools.join(",")}`;

  // Set model and provider
  piArgs += ` --provider ${context.inputs.piProvider}`;
  piArgs += ` --model ${context.inputs.piModel}`;

  // Set thinking level
  if (context.inputs.piThinkingLevel !== "off") {
    piArgs += ` --thinking ${context.inputs.piThinkingLevel}`;
  }

  // API key via CLI flag
  const apiKey = process.env.PI_API_KEY;
  if (apiKey) {
    piArgs += ` --api-key ${apiKey}`;
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
    commentId,
    branchInfo,
    piArgs: piArgs.trim(),
    isPullRequestReviewComment: commentData.isPullRequestReviewComment,
  };
}
