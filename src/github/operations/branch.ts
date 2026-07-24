import { execSync } from "child_process";
import type { Octokits } from "../api/client";
import type { EntityContext, BranchInfo, GitHubData } from "../types";

/**
 * Setup a working branch for Pi to commit to.
 */
export async function setupBranch(
  octokit: Octokits,
  githubData: GitHubData,
  context: EntityContext,
): Promise<BranchInfo> {
  const prefix = context.inputs.branchPrefix;
  const entityType = githubData.isPR ? "pr" : "issue";
  const timestamp = Date.now();
  const claudeBranch = `${prefix}${entityType}-${githubData.issueOrPrNumber}-${timestamp}`;

  // Get the base branch
  let baseBranch = context.inputs.baseBranch;
  if (!baseBranch) {
    if (githubData.isPR && githubData.baseBranch) {
      baseBranch = githubData.baseBranch;
    } else {
      // Fetch default branch from API
      const { data: repo } = await octokit.rest.repos.get({
        owner: context.repository.owner,
        repo: context.repository.repo,
      });
      baseBranch = repo.default_branch;
    }
  }

  const currentBranch = githubData.isPR && githubData.headBranch
    ? githubData.headBranch
    : baseBranch;

  // Fetch and create branch
  try {
    execSync(`git fetch origin ${currentBranch}`, { stdio: "pipe" });
    execSync(`git checkout -b ${claudeBranch} origin/${currentBranch}`, {
      stdio: "pipe",
    });
    console.log(`Created branch ${claudeBranch} from ${currentBranch}`);
  } catch (error) {
    console.error(`Failed to create branch: ${error}`);
    // Fall back to current HEAD
    try {
      execSync(`git checkout -b ${claudeBranch}`, { stdio: "pipe" });
      console.log(`Created branch ${claudeBranch} from current HEAD`);
    } catch {
      throw new Error(`Failed to create working branch ${claudeBranch}`);
    }
  }

  return {
    baseBranch,
    claudeBranch,
    currentBranch,
  };
}
