import type { Octokit } from "@octokit/rest";
import type { EntityContext } from "../types";

/**
 * Check if the actor has write permissions to the repository.
 */
export async function checkWritePermissions(
  octokit: Octokit,
  context: EntityContext,
): Promise<boolean> {
  try {
    const { data } = await octokit.repos.getCollaboratorPermissionLevel({
      owner: context.repository.owner,
      repo: context.repository.repo,
      username: context.actor,
    });

    const level = data.permission;
    return level === "admin" || level === "write";
  } catch (error) {
    console.error(`Failed to check permissions for ${context.actor}:`, error);
    return false;
  }
}
