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

  // For PR review comment replies: fetch the parent comment body
  if (context.comment?.in_reply_to_id && context.isPR) {
    try {
      const { data: parentComment } = await octokit.rest.pulls.getReviewComment({
        owner: context.repository.owner,
        repo: context.repository.repo,
        comment_id: context.comment.in_reply_to_id,
      });
      // Enrich the comment with the parent's diff_hunk and path
      if (!context.comment.diff_hunk) {
        context.comment.diff_hunk = parentComment.diff_hunk;
      }
      if (!context.comment.path) {
        context.comment.path = parentComment.path;
      }
      if (!context.comment.line) {
        context.comment.line = parentComment.line || parentComment.original_line || undefined;
      }
      // Prepend parent body to help Pi understand what to fix
      context.comment.body = `[Parent review comment by @${parentComment.user?.login}]: ${parentComment.body}\n\n[User reply]: ${context.comment.body}`;
    } catch (e) {
      console.error("Failed to fetch parent review comment:", e);
    }
  }

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

  // Detect available integrations (used in prompt + extension loading)
  const hasPostgres = !!process.env.DATABASE_URL;
  const hasK8s = !!process.env.KUBECONFIG || !!process.env.KUBE_NAMESPACE || !!process.env.KUBE_CONTEXT;

  // Create prompt file
  await createPrompt(
    commentId,
    baseBranch,
    workingBranch,
    githubData,
    context,
    { hasPostgres, hasK8s },
  );

  // Build Pi CLI args for tag mode
  const tagModeTools = [
    "read", "bash", "edit", "write", "grep", "find", "ls",
    "update_tracking_comment",
    "get_ci_status",
    "get_workflow_run_details",
    "download_job_log",
    "cancel_workflow_run",
    "get_pr_diff",
    "create_inline_comment",
    "list_review_comments",
    "resolve_review_thread",
    "add_labels",
    "remove_labels",
    "close_issue",
    "create_issue",
    "request_reviewers",
    "rebase_branch",
    "get_conflict_files",
    "web_search",
    "web_fetch",
  ];
  let piArgs = "";

  // Load our GitHub tools extension
  const extensionPath = `${process.env.GITHUB_ACTION_PATH}/extensions/github-tools.ts`;
  piArgs += ` -e ${extensionPath}`;

  // Load web search extension (keyless -- uses Brave/DuckDuckGo)
  piArgs += ` -e npm:pi-web-extension`;

  // Auto-load postgres extension if DATABASE_URL is set
  if (hasPostgres) {
    const pgPath = `${process.env.GITHUB_ACTION_PATH}/extensions/postgres-tools.ts`;
    piArgs += ` -e ${pgPath}`;
    tagModeTools.push("pg_query", "pg_schema", "pg_table_info", "pg_explain", "pg_connections");
    console.log("Postgres tools enabled (DATABASE_URL detected)");
  }

  // Auto-load kubernetes extension if kubectl/kubeconfig is available
  if (hasK8s) {
    const k8sPath = `${process.env.GITHUB_ACTION_PATH}/extensions/kubernetes-tools.ts`;
    piArgs += ` -e ${k8sPath}`;
    tagModeTools.push(
      "k8s_get", "k8s_describe", "k8s_logs", "k8s_events",
      "k8s_rollout_status", "k8s_top", "k8s_delete_pod",
      "k8s_rollout_restart", "k8s_exec",
    );
    console.log("Kubernetes tools enabled (KUBECONFIG/KUBE_NAMESPACE detected)");
  }

  // Set env vars for the extension
  process.env.REPO_OWNER = context.repository.owner;
  process.env.REPO_NAME = context.repository.repo;
  process.env.PI_COMMENT_ID = commentId.toString();
  process.env.IS_PR_REVIEW_COMMENT = commentData.isPullRequestReviewComment ? "true" : "false";
  if (context.isPR) {
    process.env.PR_NUMBER = context.entityNumber.toString();
  } else {
    process.env.ISSUE_NUMBER = context.entityNumber.toString();
  }
  process.env.BASE_BRANCH = baseBranch;

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
