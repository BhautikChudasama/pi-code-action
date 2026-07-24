/**
 * Token setup: user-provided github_token takes priority,
 * otherwise falls back to the default workflow token.
 */
export async function setupGitHubToken(): Promise<string> {
  const overrideToken = process.env.OVERRIDE_GITHUB_TOKEN;
  if (overrideToken) {
    console.log("Using user-provided GitHub token");
    return overrideToken;
  }

  const defaultToken = process.env.DEFAULT_WORKFLOW_TOKEN;
  if (defaultToken) {
    console.log("Using default workflow token");
    return defaultToken;
  }

  throw new Error(
    "No GitHub token available. Provide github_token input or ensure GITHUB_TOKEN is set.",
  );
}
