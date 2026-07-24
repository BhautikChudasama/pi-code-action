import type { Octokit } from "@octokit/rest";
import type { EntityContext } from "../types";

/**
 * Validate that the actor is a human (or an allowed bot).
 * Prevents bot-triggered infinite loops.
 */
export async function checkHumanActor(
  octokit: Octokit,
  context: EntityContext,
): Promise<void> {
  const actor = context.actor;
  const allowedBots = context.inputs.allowedBots;

  // If allowed_bots is '*', allow all
  if (allowedBots === "*") return;

  // Check if actor is a bot
  const isBot = actor.endsWith("[bot]") || actor.includes("bot");

  if (isBot) {
    // Check allowed list
    const allowedList = allowedBots
      .split(",")
      .map((b) => b.trim())
      .filter(Boolean);

    if (allowedList.includes(actor)) return;

    throw new Error(
      `Bot actor '${actor}' is not in the allowed_bots list. ` +
        `Add '${actor}' to allowed_bots or use '*' to allow all bots.`,
    );
  }

  // Verify user exists (catches deleted accounts)
  try {
    await octokit.users.getByUsername({ username: actor });
  } catch {
    throw new Error(`Could not verify actor '${actor}'`);
  }
}
