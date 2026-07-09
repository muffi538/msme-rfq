import * as Sentry from "@sentry/nextjs";

/**
 * Drop-in replacement for console.error in server code that also reports to
 * Sentry. Needed because our route handlers catch their own errors and
 * return a clean response instead of throwing — which means they never
 * reach Next.js's automatic instrumentation.ts error capture, since that
 * only fires on errors that actually propagate out of the handler.
 */
export function logError(message: string, context?: unknown): void {
  console.error(message, context);

  if (context instanceof Error) {
    Sentry.captureException(context, { extra: { message } });
  } else {
    Sentry.captureException(new Error(message), { extra: { context } });
  }
}
