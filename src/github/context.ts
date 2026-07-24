import * as github from "@actions/github";
import type {
  GitHubContext,
  EntityContext,
  GenericContext,
  ActionInputs,
  Repository,
} from "./types";

function parseInputs(): ActionInputs {
  const maxCostStr = process.env.PI_MAX_COST;
  const maxTurnsStr = process.env.PI_MAX_TURNS;

  return {
    prompt: process.env.PROMPT || undefined,
    triggerPhrase: process.env.TRIGGER_PHRASE || "@pi",
    assigneeTrigger: process.env.ASSIGNEE_TRIGGER || undefined,
    labelTrigger: process.env.LABEL_TRIGGER || undefined,
    baseBranch: process.env.BASE_BRANCH || undefined,
    branchPrefix: process.env.BRANCH_PREFIX || "pi/",
    allowedBots: process.env.ALLOWED_BOTS || "",
    useStickyComment: process.env.USE_STICKY_COMMENT === "true",
    botId: process.env.BOT_ID || "41898282",
    botName: process.env.BOT_NAME || "pi[bot]",
    trackProgress: process.env.TRACK_PROGRESS === "true",
    piProvider: process.env.PI_PROVIDER || "anthropic",
    piModel: process.env.PI_MODEL || "claude-sonnet-4-5",
    piThinkingLevel: process.env.PI_THINKING_LEVEL || "off",
    piTools: process.env.PI_TOOLS || undefined,
    piExtensions: process.env.PI_EXTENSIONS || undefined,
    piMaxCost: maxCostStr ? parseFloat(maxCostStr) : undefined,
    piMaxTurns: maxTurnsStr ? parseInt(maxTurnsStr, 10) : undefined,
  };
}

function parseRepository(): Repository {
  const ctx = github.context;
  return {
    owner: ctx.repo.owner,
    repo: ctx.repo.repo,
    default_branch: undefined, // Fetched later via API if needed
  };
}

export function parseGitHubContext(): GitHubContext {
  const ctx = github.context;
  const inputs = parseInputs();
  const repository = parseRepository();
  const actor = ctx.actor;
  const eventName = ctx.eventName;
  const eventAction = ctx.payload.action as string | undefined;
  const payload = ctx.payload as Record<string, unknown>;

  const entityEvents = [
    "issue_comment",
    "issues",
    "pull_request",
    "pull_request_review",
    "pull_request_review_comment",
  ];

  if (entityEvents.includes(eventName)) {
    const issue = ctx.payload.issue as EntityContext["issue"];
    const pullRequest = ctx.payload.pull_request as EntityContext["pullRequest"];
    const comment = ctx.payload.comment as EntityContext["comment"];
    const isPR = !!pullRequest || (eventName === "issue_comment" && !!issue?.pull_request);
    const entityNumber = pullRequest?.number || issue?.number || 0;

    return {
      kind: "entity",
      eventName,
      eventAction,
      actor,
      repository,
      inputs,
      isPR,
      entityNumber,
      issue,
      pullRequest,
      comment,
      payload,
    } as EntityContext;
  }

  return {
    kind: "generic",
    eventName,
    eventAction,
    actor,
    repository,
    inputs,
    payload,
  } as GenericContext;
}

export function isEntityContext(ctx: GitHubContext): ctx is EntityContext {
  return ctx.kind === "entity";
}

export function isIssueCommentEvent(ctx: EntityContext): boolean {
  return ctx.eventName === "issue_comment";
}

export function isIssuesEvent(ctx: EntityContext): boolean {
  return ctx.eventName === "issues";
}

export function isPullRequestEvent(ctx: EntityContext): boolean {
  return ctx.eventName === "pull_request";
}

export function isPullRequestReviewEvent(ctx: EntityContext): boolean {
  return ctx.eventName === "pull_request_review";
}

export function isPullRequestReviewCommentEvent(ctx: EntityContext): boolean {
  return ctx.eventName === "pull_request_review_comment";
}
