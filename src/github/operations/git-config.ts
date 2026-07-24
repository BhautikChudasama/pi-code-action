import { execSync } from "child_process";
import type { EntityContext } from "../types";

/**
 * Configure git authentication and user identity for commits.
 */
export async function configureGitAuth(
  githubToken: string,
  context: EntityContext,
  user: { login: string; id: number },
): Promise<void> {
  const { owner, repo } = context.repository;

  // Set user identity
  execSync(`git config user.name "${user.login}"`, { stdio: "pipe" });
  execSync(`git config user.email "${user.id}+${user.login}@users.noreply.github.com"`, {
    stdio: "pipe",
  });

  // Set remote URL with token for push access
  const remoteUrl = `https://x-access-token:${githubToken}@github.com/${owner}/${repo}.git`;
  execSync(`git remote set-url origin "${remoteUrl}"`, { stdio: "pipe" });

  console.log(`Git configured for ${user.login}`);
}
