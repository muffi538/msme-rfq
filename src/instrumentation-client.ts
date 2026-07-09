import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
    // No session replay / no extra sampling — single customer, keep this cheap.
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
