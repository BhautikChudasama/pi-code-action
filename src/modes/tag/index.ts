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
 * Key behavior (mirrors claude-code-action):
 * - On PRs: checkout existing PR branch (no new branch)
 * - On issues: DON'T create branch eagerly. Pi decides if code changes are needed.
 *   Git auth is configured so Pi can create branches/push if it needs to.
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

  // Configure git auth (always needed for potential push operations)
  const user = {
    login: context.inputs.botName,
    id: parseInt(context.inputs.botId),
  };
  await configureGitAuth(githubToken, context, user);

  // Branch setup depends on context:
  // - PRs: checkout existing PR branch
  // - Issues: don't create branch eagerly -- Pi will decide if it needs one
  let baseBranch: string;
  let workingBranch: string | undefined;

  if (context.isPR) {
    // For PRs, checkout the existing PR branch
    const branchInfo = await setupBranch(octokit, githubData, context);
    baseBranch = branchInfo.baseBranch;
    workingBranch = branchInfo.currentBranch; // existing PR branch, no new branch
  } else {
    // For issues, just determine base branch -- don't create a new one
    if (context.inputs.baseBranch) {
      baseBranch = context.inputs.baseBranch;
    } else {
      const { data: repoData } = await octokit.rest.repos.get({
        owner: context.repository.owner,
        repo: context.repository.repo,
      });
      baseBranch = repoData.default_branch;
    }
    // workingBranch stays undefined -- Pi creates one only if it needs to commit
  }

  // Create prompt file
  await createPrompt(
    commentId,
    baseBranch,
    workingBranch,
    githubData,
    context,
  );

  // Build Pi CLI args for tag mode
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
    branchInfo: {
      baseBranch,
      claudeBranch: workingBranch, // undefined for issues (no branch created)
      currentBranch: workingBranch || baseBranch,
    },
    piArgs: piArgs.trim(),
    isPullRequestReviewComment: commentData.isPullRequestReviewComment,
  };
}
