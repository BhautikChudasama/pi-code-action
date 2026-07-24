/**
 * Pi extension: GitHub Tools for pi-code-action
 *
 * Mirrors claude-code-action's MCP servers as Pi custom tools:
 * - update_tracking_comment: Live comment updates during execution
 * - get_ci_status: Read CI/CD status for PRs
 * - create_inline_comment: Post inline review comments on PR diffs
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  const owner = process.env.REPO_OWNER || "";
  const repo = process.env.REPO_NAME || "";
  const githubToken = process.env.GITHUB_TOKEN || "";
  const apiUrl = process.env.GITHUB_API_URL || "https://api.github.com";
  const commentId = process.env.PI_COMMENT_ID || "";
  const prNumber = process.env.PR_NUMBER || "";
  const isPrReviewComment = process.env.IS_PR_REVIEW_COMMENT === "true";

  /** Helper to make GitHub API requests */
  async function githubApi(
    path: string,
    options: { method?: string; body?: unknown } = {},
  ): Promise<unknown> {
    const resp = await fetch(`${apiUrl}${path}`, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`GitHub API ${resp.status}: ${text}`);
    }
    return resp.json();
  }

  // ── Tool 1: Update Tracking Comment (live updates during execution) ──

  pi.registerTool({
    name: "update_tracking_comment",
    label: "Update Comment",
    description:
      "Update the Pi tracking comment with progress and results. Use this to show real-time progress, checklists, and final output to the user.",
    promptSnippet:
      "Update the tracking GitHub comment with progress updates and results",
    promptGuidelines: [
      "Use update_tracking_comment to show progress to the user in real time.",
      "Format your comment with markdown: use ### headers, - [ ] checklists, code blocks.",
      "Update the comment as you complete each step so the user can follow along.",
      "Do NOT include the final header (Pi finished...) — that is added automatically.",
    ],
    parameters: Type.Object({
      body: Type.String({ description: "The updated comment content in markdown" }),
    }),
    async execute(_toolCallId, params) {
      if (!commentId) {
        return {
          content: [{ type: "text", text: "Error: No tracking comment ID available" }],
          details: {},
        };
      }

      try {
        // Choose correct API endpoint based on comment type
        let path: string;
        let method = "PATCH";

        if (isPrReviewComment) {
          path = `/repos/${owner}/${repo}/pulls/comments/${commentId}`;
        } else {
          path = `/repos/${owner}/${repo}/issues/comments/${commentId}`;
        }

        const result = await githubApi(path, {
          method,
          body: { body: params.body },
        });

        const data = result as { id: number; html_url: string };
        return {
          content: [
            {
              type: "text",
              text: `Comment updated successfully (id: ${data.id})`,
            },
          ],
          details: { id: data.id, url: data.html_url },
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);

        // Fallback: try issue comment API if PR review comment fails
        if (isPrReviewComment) {
          try {
            const fallbackPath = `/repos/${owner}/${repo}/issues/comments/${commentId}`;
            const result = await githubApi(fallbackPath, {
              method: "PATCH",
              body: { body: params.body },
            });
            const data = result as { id: number; html_url: string };
            return {
              content: [
                { type: "text", text: `Comment updated via fallback (id: ${data.id})` },
              ],
              details: { id: data.id, url: data.html_url },
            };
          } catch {
            // Fall through to error
          }
        }

        return {
          content: [{ type: "text", text: `Error updating comment: ${msg}` }],
          details: {},
        };
      }
    },
  });

  // ── Tool 2: Get CI Status ──

  if (prNumber) {
    pi.registerTool({
      name: "get_ci_status",
      label: "Get CI Status",
      description:
        "Get CI/CD workflow run status for the current pull request. Returns a summary of passed, failed, and pending checks.",
      promptSnippet: "Get CI status for the current PR",
      parameters: Type.Object({
        status: Type.Optional(
          Type.String({
            description:
              'Filter by status: completed, in_progress, queued, failure, success, etc.',
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        try {
          // Get PR head SHA
          const pr = (await githubApi(
            `/repos/${owner}/${repo}/pulls/${prNumber}`,
          )) as { head: { sha: string } };

          // Get workflow runs for this SHA
          const statusParam = params.status ? `&status=${params.status}` : "";
          const runs = (await githubApi(
            `/repos/${owner}/${repo}/actions/runs?head_sha=${pr.head.sha}${statusParam}`,
          )) as {
            workflow_runs: Array<{
              id: number;
              name: string;
              status: string;
              conclusion: string | null;
              html_url: string;
            }>;
          };

          const summary = { total: 0, passed: 0, failed: 0, pending: 0 };
          const items = runs.workflow_runs.map((run) => {
            summary.total++;
            if (run.status === "completed") {
              if (run.conclusion === "success") summary.passed++;
              else summary.failed++;
            } else {
              summary.pending++;
            }
            return {
              name: run.name,
              status: run.status,
              conclusion: run.conclusion,
              url: run.html_url,
            };
          });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ summary, runs: items }, null, 2),
              },
            ],
            details: { summary },
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Error getting CI status: ${msg}` }],
            details: {},
          };
        }
      },
    });
  }

  // ── Tool 3: Create Inline PR Review Comment ──

  if (prNumber) {
    pi.registerTool({
      name: "get_pr_diff",
      label: "Get PR Diff",
      description:
        "Fetch the unified diff for the current pull request. Use this BEFORE create_inline_comment to see the actual diff line numbers.",
      promptSnippet: "Fetch the PR diff to see changed files and line numbers",
      promptGuidelines: [
        "ALWAYS call get_pr_diff BEFORE using create_inline_comment.",
        "The diff shows the actual line numbers you need for inline comments.",
      ],
      parameters: Type.Object({}),
      async execute() {
        try {
          const resp = await fetch(
            `${apiUrl}/repos/${owner}/${repo}/pulls/${prNumber}`,
            {
              headers: {
                Authorization: `Bearer ${githubToken}`,
                Accept: "application/vnd.github.v3.diff",
              },
            },
          );
          if (!resp.ok) throw new Error(`GitHub API ${resp.status}`);
          const diff = await resp.text();
          // Truncate very large diffs
          const maxLen = 50000;
          const truncated = diff.length > maxLen ? diff.substring(0, maxLen) + "\n... (truncated)" : diff;
          return {
            content: [{ type: "text", text: truncated }],
            details: {},
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Error fetching diff: ${msg}` }],
            details: {},
          };
        }
      },
    });

    pi.registerTool({
      name: "create_inline_comment",
      label: "Inline Comment",
      description:
        "Post an inline review comment on a specific file and line in the PR diff. IMPORTANT: The 'line' parameter must be the line number as shown in the NEW file side of the diff (the + lines), NOT from reading the source file directly. Always use get_pr_diff first to see the correct line numbers.",
      promptSnippet: "Post inline review comments on PR diff lines",
      promptGuidelines: [
        "ALWAYS call get_pr_diff first to see the diff before posting inline comments.",
        "The 'line' must be the line number in the NEW version of the file (right side of diff, the + lines).",
        "Do NOT use line numbers from reading the file with the read tool -- use the diff line numbers.",
        "Use side RIGHT for added/modified lines, LEFT for deleted lines.",
      ],
      parameters: Type.Object({
        path: Type.String({ description: "File path relative to repo root" }),
        line: Type.Number({ description: "Line number in the NEW version of the file as shown in the diff (the + side). NOT from reading the file directly." }),
        body: Type.String({ description: "Comment text in markdown" }),
        side: Type.Optional(
          Type.String({
            description: 'Side of the diff: RIGHT (default) for additions, LEFT for deletions',
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        try {
          // Get the latest commit SHA for the PR
          const pr = (await githubApi(
            `/repos/${owner}/${repo}/pulls/${prNumber}`,
          )) as { head: { sha: string } };

          const result = await githubApi(
            `/repos/${owner}/${repo}/pulls/${prNumber}/comments`,
            {
              method: "POST",
              body: {
                body: params.body,
                commit_id: pr.head.sha,
                path: params.path,
                line: params.line,
                side: params.side || "RIGHT",
              },
            },
          );

          const data = result as { id: number; html_url: string };
          return {
            content: [
              {
                type: "text",
                text: `Inline comment posted on ${params.path}:${params.line} (id: ${data.id})`,
              },
            ],
            details: { id: data.id, url: data.html_url },
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Error posting inline comment: ${msg}` }],
            details: {},
          };
        }
      },
    });

    // ── Tool 5: List Review Comments ──

    pi.registerTool({
      name: "list_review_comments",
      label: "List Review Comments",
      description:
        "List all review comments on the current PR with their IDs, resolved status, file paths, and content. Use this to see which review threads exist and which need to be resolved.",
      promptSnippet: "List all PR review comments with their status",
      parameters: Type.Object({}),
      async execute() {
        try {
          const comments = (await githubApi(
            `/repos/${owner}/${repo}/pulls/${prNumber}/comments?per_page=100`,
          )) as Array<{
            id: number;
            body: string;
            path: string;
            line: number | null;
            user: { login: string };
            in_reply_to_id?: number;
            created_at: string;
          }>;

          const formatted = comments.map((c) => ({
            id: c.id,
            author: c.user.login,
            path: c.path,
            line: c.line,
            body: c.body.substring(0, 200),
            is_reply: !!c.in_reply_to_id,
            parent_id: c.in_reply_to_id || null,
          }));

          return {
            content: [
              { type: "text", text: JSON.stringify(formatted, null, 2) },
            ],
            details: {},
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Error listing comments: ${msg}` }],
            details: {},
          };
        }
      },
    });

    // ── Tool 6: Resolve Review Thread ──

    pi.registerTool({
      name: "resolve_review_thread",
      label: "Resolve Thread",
      description:
        "Resolve (minimize) a PR review comment thread by posting a resolution reply. Use this after verifying that the issue raised in a review comment has been fixed.",
      promptSnippet: "Resolve a PR review comment thread",
      promptGuidelines: [
        "Use list_review_comments first to see which threads exist.",
        "Only resolve threads where the issue has actually been fixed in the code.",
        "The comment_id should be the ID of the TOP-LEVEL review comment (not a reply).",
      ],
      parameters: Type.Object({
        comment_id: Type.Number({ description: "ID of the top-level review comment to resolve" }),
        message: Type.Optional(Type.String({ description: "Optional resolution message (e.g. 'Fixed in latest commit')" })),
      }),
      async execute(_toolCallId, params) {
        try {
          // Reply to the thread indicating it's resolved
          const body = params.message || "Resolved -- this has been addressed.";
          await githubApi(
            `/repos/${owner}/${repo}/pulls/${prNumber}/comments/${params.comment_id}/replies`,
            {
              method: "POST",
              body: { body },
            },
          );

          return {
            content: [
              { type: "text", text: `Thread ${params.comment_id} resolved with reply.` },
            ],
            details: {},
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Error resolving thread: ${msg}` }],
            details: {},
          };
        }
      },
    });
  }
}

