import type { GitHubContext, EntityContext } from "../github/types";
import {
  isEntityContext,
  isIssueCommentEvent,
  isPullRequestReviewCommentEvent,
  isPullRequestReviewEvent,
  isPullRequestEvent,
  isIssuesEvent,
} from "../github/context";
import { checkContainsTrigger } from "../github/validation/trigger";

export type AutoDetectedMode = "tag" | "agent";

export function detectMode(context: GitHubContext): AutoDetectedMode {
  // If track_progress is set for PR/issue events, force tag mode
  if (context.inputs.trackProgress && isEntityContext(context)) {
    if (
      isPullRequestEvent(context) ||
      isIssuesEvent(context) ||
      isIssueCommentEvent(context) ||
      isPullRequestReviewCommentEvent(context) ||
      isPullRequestReviewEvent(context)
    ) {
      return "tag";
    }
  }

  // Comment events
  if (isEntityContext(context)) {
    if (
      isIssueCommentEvent(context) ||
      isPullRequestReviewCommentEvent(context) ||
      isPullRequestReviewEvent(context)
    ) {
      if (context.inputs.prompt) return "agent";
      if (checkContainsTrigger(context)) return "tag";
    }
  }

  // Issue events
  if (isEntityContext(context) && isIssuesEvent(context)) {
    if (context.inputs.prompt) return "agent";
    if (checkContainsTrigger(context)) return "tag";
  }

  // PR events
  if (isEntityContext(context) && isPullRequestEvent(context)) {
    const supported = ["opened", "synchronize", "ready_for_review", "reopened"];
    if (context.eventAction && supported.includes(context.eventAction)) {
      if (context.inputs.prompt) return "agent";
    }
  }

  // Default to agent mode
  return "agent";
}
