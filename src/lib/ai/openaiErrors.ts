// Shared by every OpenAI call site (normalize.ts, extractText.ts,
// rfq-reply/extract/route.ts) — classifies a failed response into a clean,
// human message and whether retrying is worth attempting at all.
//
// Root cause this exists for: a real production failure (an OpenAI account
// out of billing credits) surfaced two ways, both wrong. First, the raw
// response body — a nested JSON error object — was thrown and displayed
// verbatim as a user-facing warning, technical and useless to a
// non-technical user. Second, every retry/fallback layer treated this 429
// identically to a transient rate limit, burning 2-3 wasted attempts (each
// with its own backoff delay, and normalize.ts additionally falling back to
// json_object mode) on a call that could only ever fail the same way again
// until the account's billing was actually fixed — retrying an
// account-level block is never useful, unlike retrying a rate limit.
export function isInsufficientQuota(status: number, bodyText: string): boolean {
  return status === 429 && /insufficient_quota|credit_balance_exhausted/i.test(bodyText);
}

export function friendlyOpenAiErrorMessage(status: number, bodyText: string): string {
  if (isInsufficientQuota(status, bodyText)) {
    return "The AI service has run out of credits. Add credits at platform.openai.com (Settings → Billing), then try again — nothing else needs to change.";
  }
  if (status === 429) return "The AI service is temporarily busy. Please try again in a few minutes.";
  if (status >= 500) return "The AI service is temporarily unavailable. Please try again in a few minutes.";
  return "The AI service returned an unexpected error. Please try again.";
}
