import type { Octokit } from "@octokit/rest";
import type { EntityContext } from "../../types";
import { isPullRequestReviewCommentEvent } from "../../context";

const GITHUB_SERVER_URL = process.env.GITHUB_SERVER_URL || "https://github.com";

/** Animated Pi logo */
const PI_SPINNER_HTML =
  '<img src="https://raw.githubusercontent.com/BhautikChudasama/pi-code-action/main/assets/pi-logo-animation.gif" width="20px" height="20px" style="vertical-align: middle;" />';

export function createJobRunLink(owner: string, repo: string, runId: string): string {
  return `[View job run](${GITHUB_SERVER_URL}/${owner}/${repo}/actions/runs/${runId})`;
}

function createCommentBody(jobRunLink: string): string {
  return `${PI_SPINNER_HTML}

${jobRunLink}`;
}

/**
 * Create the initial tracking comment showing Pi is working.
 * For PR review comments: replies inline in the same thread (like claude-code-action).
 * For issue/PR comments: posts as a regular comment.
 */
export async function createInitialComment(
  octokit: Octokit,
  context: EntityContext,
): Promise<{ id: number; isPullRequestReviewComment: boolean }> {
  const { owner, repo } = context.repository;
  const runId = process.env.GITHUB_RUN_ID || "";
  const jobRunLink = runId ? createJobRunLink(owner, repo, runId) : "";
  const initialBody = createCommentBody(jobRunLink);

  try {
    let response;
    let isReviewComment = false;

    if (isPullRequestReviewCommentEvent(context) && context.comment?.id) {
      // Reply inline in the PR review comment thread
      response = await octokit.rest.pulls.createReplyForReviewComment({
        owner,
        repo,
        pull_number: context.entityNumber,
        comment_id: context.comment.id,
        body: initialBody,
      });
      isReviewComment = true;
    } else {
      // Regular issue/PR comment
      response = await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: context.entityNumber,
        body: initialBody,
      });
    }

    console.log(`Created initial comment with ID: ${response.data.id} (review: ${isReviewComment})`);
    return { id: response.data.id, isPullRequestReviewComment: isReviewComment };
  } catch (error) {
    console.error("Error creating initial comment, falling back to issue comment:", error);
    // Fallback to regular issue comment
    const response = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: context.entityNumber,
      body: initialBody,
    });
    return { id: response.data.id, isPullRequestReviewComment: false };
  }
}
