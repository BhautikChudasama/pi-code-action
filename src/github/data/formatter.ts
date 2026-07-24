import type { GitHubData } from "../types";

/**
 * Format GitHub data into a markdown prompt for Pi.
 */
export function formatGitHubDataAsPrompt(data: GitHubData): string {
  const lines: string[] = [];

  // Header
  const entityType = data.isPR ? "Pull Request" : "Issue";
  lines.push(`# ${entityType} #${data.issueOrPrNumber}: ${data.title}`);
  lines.push("");

  // Labels
  if (data.labels.length > 0) {
    lines.push(`**Labels:** ${data.labels.join(", ")}`);
    lines.push("");
  }

  // Branch info (for PRs)
  if (data.isPR && data.baseBranch && data.headBranch) {
    lines.push(`**Base branch:** ${data.baseBranch}`);
    lines.push(`**Head branch:** ${data.headBranch}`);
    lines.push("");
  }

  // Body
  if (data.body) {
    lines.push("## Description");
    lines.push("");
    lines.push(data.body);
    lines.push("");
  }

  // Comments
  if (data.comments.length > 0) {
    lines.push("## Comments");
    lines.push("");
    for (const comment of data.comments) {
      lines.push(`### @${comment.author} (${comment.createdAt})`);
      lines.push("");
      lines.push(comment.body);
      lines.push("");
    }
  }

  // Diff
  if (data.diff) {
    lines.push("## Diff");
    lines.push("");
    lines.push("```diff");
    // Truncate very large diffs
    const maxDiffLength = 50000;
    if (data.diff.length > maxDiffLength) {
      lines.push(data.diff.substring(0, maxDiffLength));
      lines.push("... (diff truncated)");
    } else {
      lines.push(data.diff);
    }
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}
