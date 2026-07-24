import type { Octokit } from "@octokit/rest";
import type { EntityContext } from "../../types";
import { parsePiOutput, cleanPiResponseForComment } from "../../../utils/parse-pi-output";

export interface UpdateCommentOptions {
  commentId: number;
  context: EntityContext;
  octokit: Octokit;
  success: boolean;
  branchName?: string;
  baseBranch: string;
  error?: string;
  /** Raw JSONL output from Pi CLI */
  executionOutput?: string;
  /** Wall-clock start time (ms since epoch) for accurate duration */
  startTimeMs?: number;
  /** Whether the comment is a PR review comment (needs different API) */
  isPullRequestReviewComment?: boolean;
}

/**
 * Update the tracking comment with final status and Pi's response.
 * Matches claude-code-action's format:
 *   **Pi finished @user's task in Xm Ys** —— [View job] • [`branch`] • [Create PR ➔]
 *   ---
 *   <Pi's cleaned response>
 */
export async function updateTrackingComment(opts: UpdateCommentOptions): Promise<void> {
  const {
    commentId,
    context,
    octokit,
    success,
    branchName,
    baseBranch,
    error,
    executionOutput,
    startTimeMs,
  } = opts;

  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  const { owner, repo } = context.repository;
  const runId = process.env.GITHUB_RUN_ID;

  // Parse Pi's JSONL output
  let piText = "";
  let prLinkFromResponse: string | undefined;
  let durationStr = "";
  if (executionOutput) {
    const parsed = parsePiOutput(executionOutput);
    const { cleanedText, prLink } = cleanPiResponseForComment(parsed.text);
    piText = cleanedText;
    prLinkFromResponse = prLink;

    // Duration: prefer wall-clock time, fallback to JSONL timestamps
    const durationMs = startTimeMs
      ? Date.now() - startTimeMs
      : parsed.durationMs;
    if (durationMs && durationMs > 0) {
      const totalSeconds = Math.round(durationMs / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      durationStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
    }
  } else if (startTimeMs) {
    const durationMs = Date.now() - startTimeMs;
    const totalSeconds = Math.round(durationMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    durationStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  }

  // Build header
  let header = "";
  if (success) {
    header = `**Pi finished @${context.actor}'s task`;
    if (durationStr) header += ` in ${durationStr}`;
    header += "**";
  } else {
    header = "**Pi encountered an error";
    if (durationStr) header += ` after ${durationStr}`;
    header += "**";
  }

  // Build links (same line as header, like claude-code-action)
  let links = "";
  if (runId) {
    const jobUrl = `${serverUrl}/${owner}/${repo}/actions/runs/${runId}`;
    links += ` —— [View job](${jobUrl})`;
  }
  if (branchName) {
    const branchUrl = `${serverUrl}/${owner}/${repo}/tree/${branchName}`;
    links += ` • [\`${branchName}\`](${branchUrl})`;
  }
  if (prLinkFromResponse) {
    links += ` • [Create PR ➔](${prLinkFromResponse})`;
  }

  // Check if Pi already updated the comment live via update_tracking_comment.
  // If so, preserve Pi's live content and just prepend the header.
  let liveContent: string | undefined;
  try {
    let commentData: { body?: string; created_at: string; updated_at: string };
    if (opts.isPullRequestReviewComment) {
      const resp = await octokit.pulls.getReviewComment({ owner, repo, comment_id: commentId });
      commentData = resp.data;
    } else {
      const resp = await octokit.issues.getComment({ owner, repo, comment_id: commentId });
      commentData = resp.data;
    }
    // If comment was edited after creation, Pi updated it live
    const wasEdited = commentData.created_at !== commentData.updated_at;
    if (wasEdited && commentData.body) {
      liveContent = commentData.body;
    }
  } catch {
    // Can't read current comment, proceed with normal update
  }

  // Assemble body
  let body: string;

  if (liveContent) {
    // Pi already wrote the comment live — just prepend the header
    body = `${header}${links}\n\n---\n\n${liveContent}`;
  } else {
    body = `${header}${links}`;

    // Add error details
    if (!success && error) {
      body += `\n\n\`\`\`\n${error}\n\`\`\``;
    }

    body += "\n\n---\n";

    // Add Pi's cleaned response
    if (piText) {
      body += `\n${piText}`;
    } else if (!error) {
      body += "\n_No text output from Pi._";
    }
  }

  // Use correct API based on comment type (like claude-code-action)
  try {
    if (opts.isPullRequestReviewComment) {
      await octokit.pulls.updateReviewComment({
        owner,
        repo,
        comment_id: commentId,
        body: body.trim(),
      });
    } else {
      await octokit.issues.updateComment({
        owner,
        repo,
        comment_id: commentId,
        body: body.trim(),
      });
    }
  } catch (error: unknown) {
    // Fallback: if PR review comment update fails with 404, try issue comment API
    const status = (error as { status?: number }).status;
    if (opts.isPullRequestReviewComment && status === 404) {
      await octokit.issues.updateComment({
        owner,
        repo,
        comment_id: commentId,
        body: body.trim(),
      });
    } else {
      throw error;
    }
  }
}
