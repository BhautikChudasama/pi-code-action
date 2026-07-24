import type { Octokits } from "../api/client";
import type { GitHubData } from "../types";

export interface FetchOptions {
  octokits: Octokits;
  repository: string;
  issueOrPrNumber: string;
  isPR: boolean;
  triggerUsername: string;
}

/**
 * Fetch all GitHub data needed to construct the prompt.
 */
export async function fetchGitHubData(opts: FetchOptions): Promise<GitHubData> {
  const { octokits, repository, issueOrPrNumber, isPR } = opts;
  const [owner, repo] = repository.split("/");
  const number = parseInt(issueOrPrNumber, 10);
  const octokit = octokits.rest;

  // Fetch issue/PR details
  const { data: issue } = await octokit.issues.get({
    owner,
    repo,
    issue_number: number,
  });

  // Fetch comments
  const { data: rawComments } = await octokit.issues.listComments({
    owner,
    repo,
    issue_number: number,
    per_page: 100,
  });

  const comments = rawComments.map((c) => ({
    author: c.user?.login || "unknown",
    body: c.body || "",
    createdAt: c.created_at,
  }));

  const labels = issue.labels.map((l) => (typeof l === "string" ? l : l.name || ""));

  let diff: string | undefined;
  let baseBranch: string | undefined;
  let headBranch: string | undefined;

  // If it's a PR, fetch diff and branch info
  if (isPR) {
    try {
      const { data: pr } = await octokit.pulls.get({
        owner,
        repo,
        pull_number: number,
      });
      baseBranch = pr.base.ref;
      headBranch = pr.head.ref;

      // Fetch diff
      const { data: diffData } = await octokit.pulls.get({
        owner,
        repo,
        pull_number: number,
        mediaType: { format: "diff" },
      });
      diff = diffData as unknown as string;
    } catch (error) {
      console.error("Failed to fetch PR diff:", error);
    }
  }

  return {
    issueOrPrNumber: number,
    isPR,
    title: issue.title,
    body: issue.body,
    comments,
    diff,
    labels,
    baseBranch,
    headBranch,
  };
}

/**
 * Extract the user's actual request from the trigger comment.
 */
export function extractUserRequest(
  triggerPhrase: string,
  commentBody: string,
): string {
  const idx = commentBody.indexOf(triggerPhrase);
  if (idx === -1) return commentBody;
  return commentBody.substring(idx + triggerPhrase.length).trim();
}
