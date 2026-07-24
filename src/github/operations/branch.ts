import { execSync } from "child_process";
import type { Octokits } from "../api/client";
import type { EntityContext, BranchInfo, GitHubData } from "../types";

/**
 * Setup the appropriate branch based on event type (mirrors claude-code-action):
 * - For open PRs: checkout the existing PR branch (no new branch)
 * - For issues / closed PRs: create a new branch
 */
export async function setupBranch(
  octokit: Octokits,
  githubData: GitHubData,
  context: EntityContext,
): Promise<BranchInfo> {
  const { owner, repo } = context.repository;

  // Get the base branch
  let baseBranch = context.inputs.baseBranch;
  if (!baseBranch) {
    if (githubData.isPR && githubData.baseBranch) {
      baseBranch = githubData.baseBranch;
    } else {
      const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
      baseBranch = repoData.default_branch;
    }
  }

  // For open PRs: checkout existing PR branch, don't create a new one
  if (githubData.isPR && githubData.headBranch) {
    const prBranch = githubData.headBranch;
    console.log(`Open PR detected, checking out existing branch: ${prBranch}`);

    try {
      execSync(`git fetch origin ${prBranch}`, { stdio: "pipe" });
      execSync(`git checkout ${prBranch} --`, { stdio: "pipe" });
      console.log(`Successfully checked out PR branch: ${prBranch}`);
    } catch {
      // Fallback: try creating from origin
      try {
        execSync(`git checkout -b ${prBranch} origin/${prBranch}`, { stdio: "pipe" });
      } catch {
        throw new Error(`Failed to checkout PR branch ${prBranch}`);
      }
    }

    return {
      baseBranch,
      currentBranch: prBranch,
      // No claudeBranch — we're on the existing PR branch
    };
  }

  // For issues: create a new branch
  const prefix = context.inputs.branchPrefix;
  const timestamp = Date.now();
  const newBranch = `${prefix}issue-${githubData.issueOrPrNumber}-${timestamp}`;

  try {
    execSync(`git fetch origin ${baseBranch}`, { stdio: "pipe" });
    execSync(`git checkout -b ${newBranch} origin/${baseBranch}`, { stdio: "pipe" });
    console.log(`Created branch ${newBranch} from ${baseBranch}`);
  } catch {
    try {
      execSync(`git checkout -b ${newBranch}`, { stdio: "pipe" });
      console.log(`Created branch ${newBranch} from current HEAD`);
    } catch {
      throw new Error(`Failed to create working branch ${newBranch}`);
    }
  }

  return {
    baseBranch,
    claudeBranch: newBranch,
    currentBranch: baseBranch,
  };
}
