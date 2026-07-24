import type { Octokit } from "@octokit/rest";
import type { EntityContext } from "../../types";
import { parsePiOutput } from "../../../utils/parse-pi-output";

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
}

/**
 * Update the tracking comment with final status and Pi's response.
 * Mirrors claude-code-action's comment format:
 *   Header (with duration + links) → separator → Pi's response content
 */
export async function updateTrackingComment(opts: UpdateCommentOptions): Promise<void> {
  const { commentId, context, octokit, success, branchName, error, executionOutput } = opts;

  // Parse Pi's JSONL output to extract text and metadata
  let piText = "";
  let durationStr = "";
  let model = "";
  if (executionOutput) {
    const parsed = parsePiOutput(executionOutput);
    piText = parsed.text;
    model = parsed.model || "";

    if (parsed.durationMs) {
      const totalSeconds = Math.round(parsed.durationMs / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      durationStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
    }
  }

  // Build header (like claude-code-action)
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

  // Build links section
  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  const runId = process.env.GITHUB_RUN_ID;
  let links = "";
  if (runId) {
    const jobUrl = `${serverUrl}/${context.repository.owner}/${context.repository.repo}/actions/runs/${runId}`;
    links += ` —— [View job](${jobUrl})`;
  }

  if (branchName) {
    const branchUrl = `${serverUrl}/${context.repository.owner}/${context.repository.repo}/tree/${branchName}`;
    links += ` • [\`${branchName}\`](${branchUrl})`;
  }

  // Build the comment body
  let body = `${header}${links}`;

  // Add model info
  if (model) {
    body += `\n\n_Model: ${model}_`;
  }

  // Add error details
  if (!success && error) {
    body += `\n\n\`\`\`\n${error}\n\`\`\``;
  }

  body += "\n\n---\n";

  // Add Pi's response text
  if (piText) {
    body += `\n${piText}`;
  } else if (!error) {
    body += "\n_No text output from Pi._";
  }

  await octokit.issues.updateComment({
    owner: context.repository.owner,
    repo: context.repository.repo,
    comment_id: commentId,
    body: body.trim(),
  });
}
