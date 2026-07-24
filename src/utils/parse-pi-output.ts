/**
 * Parse Pi's JSONL (JSON Lines) output to extract the assistant's text response
 * and execution metadata.
 */

export interface PiExecutionResult {
  /** Assembled assistant text response */
  text: string;
  /** Token usage if available */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  /** Duration in ms (from session start to agent_end) */
  durationMs?: number;
  /** Model used */
  model?: string;
  /** Provider used */
  provider?: string;
}

export function parsePiOutput(rawOutput: string): PiExecutionResult {
  const lines = rawOutput.split("\n").filter((l) => l.trim());
  const textChunks: string[] = [];
  let usage: PiExecutionResult["usage"];
  let model: string | undefined;
  let provider: string | undefined;
  let sessionTimestamp: number | undefined;
  let agentEndTimestamp: number | undefined;

  for (const line of lines) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    // Get session start time for accurate duration
    if (event.type === "session") {
      const ts = (event as { timestamp?: string }).timestamp;
      if (ts) sessionTimestamp = new Date(ts).getTime();
    }

    // Extract from agent_end — contains the complete conversation
    if (event.type === "agent_end") {
      // Use the last message timestamp for duration
      const messages = (event as { messages?: Array<Record<string, unknown>> }).messages || [];
      for (const msg of messages) {
        if (msg.role === "assistant") {
          const content = msg.content as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "text" && typeof block.text === "string") {
                textChunks.push(block.text);
              }
            }
          }
          // Extract usage (accumulate across all assistant messages)
          const msgUsage = msg.usage as Record<string, number> | undefined;
          if (msgUsage) {
            if (!usage) {
              usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
            }
            usage.inputTokens += msgUsage.input || 0;
            usage.outputTokens += msgUsage.output || 0;
            usage.totalTokens += msgUsage.totalTokens || 0;
          }
          // Extract model info from last assistant message
          if (typeof msg.model === "string") model = msg.model;
          if (typeof msg.provider === "string") provider = msg.provider;
          // Get timestamp
          if (typeof msg.timestamp === "number") agentEndTimestamp = msg.timestamp;
        }
      }
    }
  }

  // Fallback: if no text from agent_end, try message_end events
  if (textChunks.length === 0) {
    for (const line of lines) {
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.type === "message_end") {
        const msg = event.message as Record<string, unknown> | undefined;
        if (msg?.role === "assistant") {
          const content = msg.content as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "text" && typeof block.text === "string") {
                textChunks.push(block.text);
              }
            }
          }
        }
      }
    }
  }

  // Calculate duration from session start to last assistant message
  const durationMs =
    sessionTimestamp && agentEndTimestamp
      ? agentEndTimestamp - sessionTimestamp
      : undefined;

  return {
    text: textChunks.join("\n\n").trim(),
    usage,
    durationMs,
    model,
    provider,
  };
}

/**
 * Clean Pi's response text for display in a GitHub comment.
 * - Extracts PR creation link and returns it separately
 * - Removes duplicate "View job run" and "View branch" links (we add those in the header)
 * - Removes trailing link sections
 */
export function cleanPiResponseForComment(text: string): {
  cleanedText: string;
  prLink?: string;
} {
  let cleaned = text;

  // Extract PR creation link
  let prLink: string | undefined;
  const prLinkPattern = /\[Create a PR\]\(([^)]+)\)/;
  const prMatch = cleaned.match(prLinkPattern);
  if (prMatch && prMatch[1]) {
    prLink = prMatch[1];
  }

  // Remove "View job run" links (we add this in the header)
  cleaned = cleaned.replace(/\n*-?\s*\[View job run\]\([^)]+\)/g, "");
  cleaned = cleaned.replace(/\n*\[View job run\]\([^)]+\)/g, "");

  // Remove "View branch" links (we add this in the header)
  cleaned = cleaned.replace(/\n*-?\s*\[View branch\]\([^)]+\)/g, "");
  cleaned = cleaned.replace(/\n*\[View branch\]\([^)]+\)/g, "");

  // Remove trailing "Links" sections that Pi generates
  cleaned = cleaned.replace(/\n*#{1,3}\s*📎?\s*Links:?\s*\n*/gi, "\n");

  // Remove trailing whitespace and extra newlines
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  return { cleanedText: cleaned, prLink };
}
