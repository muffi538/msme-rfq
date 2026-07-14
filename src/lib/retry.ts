import { logError } from "@/lib/logError";

/**
 * Retries a transient, network/API-dependent operation with exponential
 * backoff — used for the genuinely flaky parts of the pipeline (OpenAI
 * calls, storage downloads, DB writes), not for logic errors that will
 * fail the same way every time (those should surface immediately).
 *
 * `isRetryable` lets a caller opt out of retrying errors that are never
 * going to succeed on retry (e.g. a 4xx "invalid request" from OpenAI) —
 * defaults to retrying everything, since most failures this wraps really
 * are transient (timeouts, 429s, momentary network blips).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    retries?: number; baseDelayMs?: number; label?: string; isRetryable?: (err: unknown) => boolean;
    /** Fires right before each attempt starts (0-indexed) — an opt-in hook for callers that want to
     * report real per-attempt progress (e.g. a long-running call with no other observable milestone
     * between "started" and "finished"). No-op for every existing caller that doesn't pass it. */
    onAttemptStart?: (attempt: number, maxAttempts: number) => void;
  } = {}
): Promise<T> {
  const { retries = 2, baseDelayMs = 500, label = "operation", isRetryable = () => true, onAttemptStart } = opts;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    onAttemptStart?.(attempt, retries + 1);
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isLastAttempt = attempt === retries;
      if (isLastAttempt || !isRetryable(err)) break;
      logError(`[retry] ${label} failed (attempt ${attempt + 1}/${retries + 1}), retrying`, err);
      const delay = baseDelayMs * 2 ** attempt;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
