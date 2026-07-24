/**
 * Retry a function with exponential backoff.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; delayMs?: number; label?: string } = {},
): Promise<T> {
  const { maxAttempts = 3, delayMs = 1000, label = "operation" } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) {
        throw new Error(
          `${label} failed after ${maxAttempts} attempts: ${error}`,
        );
      }
      const wait = delayMs * Math.pow(2, attempt - 1);
      console.log(`${label} attempt ${attempt} failed, retrying in ${wait}ms...`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  throw new Error("unreachable");
}
