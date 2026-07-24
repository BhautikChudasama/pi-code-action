import type { Octokit } from "@octokit/rest";
import type { EntityContext } from "../../types";

/**
 * Create the initial tracking comment showing Pi is working.
 */
export async function createInitialComment(
  octokit: Octokit,
  context: EntityContext,
): Promise<{ id: number }> {
  const body = [
    "🤖 **Pi is working on this...**",
    "",
    `Triggered by @${context.actor}`,
    "",
    "---",
    `⏳ _Processing..._`,
  ].join("\n");

  const { data } = await octokit.issues.createComment({
    owner: context.repository.owner,
    repo: context.repository.repo,
    issue_number: context.entityNumber,
    body,
  });

  return { id: data.id };
}
