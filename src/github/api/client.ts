import { Octokit } from "@octokit/rest";

export interface Octokits {
  rest: Octokit;
}

export function createOctokit(token: string): Octokits {
  const rest = new Octokit({
    auth: token,
    baseUrl: process.env.GITHUB_API_URL || "https://api.github.com",
  });

  return { rest };
}
