import type { EntityContext } from "../types";
import {
  isIssueCommentEvent,
  isIssuesEvent,
  isPullRequestEvent,
  isPullRequestReviewEvent,
  isPullRequestReviewCommentEvent,
} from "../context";

/**
 * Check if the event contains the trigger phrase, assignee, or label.
 */
export function checkContainsTrigger(context: EntityContext): boolean {
  const { triggerPhrase, assigneeTrigger, labelTrigger } = context.inputs;

  // Comment events: check comment body for trigger phrase
  if (
    isIssueCommentEvent(context) ||
    isPullRequestReviewCommentEvent(context) ||
    isPullRequestReviewEvent(context)
  ) {
    const commentBody = context.comment?.body || "";
    if (triggerPhrase && commentBody.includes(triggerPhrase)) {
      return true;
    }
  }

  // Issue events: check body, labels, and assignees
  if (isIssuesEvent(context)) {
    const issue = context.issue;
    if (!issue) return false;

    // Check issue body for trigger phrase
    if (context.eventAction === "opened" || context.eventAction === "edited") {
      if (triggerPhrase && issue.body?.includes(triggerPhrase)) {
        return true;
      }
    }

    // Check labels
    if (context.eventAction === "labeled" && labelTrigger) {
      const hasLabel = issue.labels.some((l) => l.name === labelTrigger);
      if (hasLabel) return true;
    }

    // Check assignees
    if (context.eventAction === "assigned" && assigneeTrigger) {
      const isAssigned = issue.assignees.some((a) => a.login === assigneeTrigger);
      if (isAssigned) return true;
    }
  }

  // PR events with track_progress
  if (isPullRequestEvent(context) && context.inputs.trackProgress) {
    return true;
  }

  return false;
}
