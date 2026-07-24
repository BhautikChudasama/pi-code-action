import type { Octokit } from "@octokit/rest";
import type { EntityContext } from "../../types";

export interface UpdateCommentOptions {
  commentId: number;
  context: EntityContext;
  octokit: Octokit;
  success: boolean;
  branchName?: string;
  baseBranch: string;
  error?: string;
  executionOutput?: string;
}

/**
 * Update the tracking comment with final status.
 */
export async function updateTrackingComment(opts: UpdateCommentOptions): Promise<void> {
  const { commentId, context, octokit, success, branchName, error, executionOutput } = opts;

  const lines: string[] = [];

  if (success) {
    lines.push("✅ **Pi completed successfully**");
  } else {
    lines.push("❌ **Pi encountered an error**");
  }

  lines.push("");
  lines.push(`Triggered by @${context.actor}`);

  if (branchName) {
    lines.push("");
    lines.push(`Branch: \`${branchName}\``);
  }

  if (error) {
    lines.push("");
    lines.push("**Error:**");
    lines.push("```");
    lines.push(error);
    lines.push("```");
  }

  if (executionOutput) {
    lines.push("");
    lines.push("<details>");
    lines.push("<summary>Execution Output</summary>");
    lines.push("");
    lines.push(executionOutput);
    lines.push("");
    lines.push("</details>");
  }

  const runId = process.env.GITHUB_RUN_ID;
  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  if (runId) {
    lines.push("");
    lines.push(
      `[View action run](${serverUrl}/${context.repository.owner}/${context.repository.repo}/actions/runs/${runId})`,
    );
  }

  await octokit.issues.updateComment({
    owner: context.repository.owner,
    repo: context.repository.repo,
    comment_id: commentId,
    body: lines.join("\n"),
  });
}
