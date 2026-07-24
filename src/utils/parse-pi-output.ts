/**
 * Parse Pi's JSONL (JSON Lines) output to extract the assistant's text response
 * and execution metadata.
 *
 * Pi outputs events as newline-delimited JSON. The key event types:
 * - session: session metadata
 * - message_update: streaming text/thinking deltas
 * - message_end: completed message with final content
 * - tool_execution_end: tool results
 * - agent_end: final summary with all messages
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
  /** Duration in ms (from first to last event) */
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
  let firstTimestamp: number | undefined;
  let lastTimestamp: number | undefined;

  for (const line of lines) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    // Track timestamps for duration
    const ts = (event as { timestamp?: string }).timestamp;
    if (ts) {
      const t = new Date(ts).getTime();
      if (!firstTimestamp) firstTimestamp = t;
      lastTimestamp = t;
    }

    // Extract from agent_end — contains the complete conversation
    if (event.type === "agent_end") {
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
          // Extract usage from last assistant message
          const msgUsage = msg.usage as Record<string, number> | undefined;
          if (msgUsage) {
            usage = {
              inputTokens: msgUsage.input || 0,
              outputTokens: msgUsage.output || 0,
              totalTokens: msgUsage.totalTokens || 0,
            };
          }
          // Extract model info
          if (typeof msg.model === "string") model = msg.model;
          if (typeof msg.provider === "string") provider = msg.provider;
        }
      }
    }
  }

  // If we didn't get text from agent_end, try message_end events
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

  const durationMs =
    firstTimestamp && lastTimestamp ? lastTimestamp - firstTimestamp : undefined;

  return {
    text: textChunks.join("\n\n").trim(),
    usage,
    durationMs,
    model,
    provider,
  };
}
