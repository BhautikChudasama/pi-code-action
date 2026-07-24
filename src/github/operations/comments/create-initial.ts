import type { Octokit } from "@octokit/rest";
import type { EntityContext } from "../../types";

const GITHUB_SERVER_URL = process.env.GITHUB_SERVER_URL || "https://github.com";

/** Animated spinner (same as claude-code-action) */
const SPINNER_HTML =
  '<img src="https://github.com/user-attachments/assets/5ac382c7-e004-429b-8e35-7feb3e8f9c6f" width="14px" height="14px" style="vertical-align: middle; margin-left: 4px;" />';

export function createJobRunLink(owner: string, repo: string, runId: string): string {
  return `[View job run](${GITHUB_SERVER_URL}/${owner}/${repo}/actions/runs/${runId})`;
}

export function createBranchLink(owner: string, repo: string, branchName: string): string {
  return `\n[View branch](${GITHUB_SERVER_URL}/${owner}/${repo}/tree/${branchName})`;
}

/**
 * Create the initial tracking comment showing Pi is working.
 * Mirrors claude-code-action's format: spinner + placeholder + links.
 */
export async function createInitialComment(
  octokit: Octokit,
  context: EntityContext,
  branchName?: string,
): Promise<{ id: number }> {
  const { owner, repo } = context.repository;
  const runId = process.env.GITHUB_RUN_ID || "";

  const jobRunLink = runId ? createJobRunLink(owner, repo, runId) : "";
  const branchLink = branchName ? createBranchLink(owner, repo, branchName) : "";

  const body = `Pi is working… ${SPINNER_HTML}

I'll analyze this and get back to you.

${jobRunLink}${branchLink}`;

  const { data } = await octokit.issues.createComment({
    owner,
    repo,
    issue_number: context.entityNumber,
    body,
  });

  return { id: data.id };
}
