import * as Sentry from "@sentry/node-core"

/**
 * Error reporting to GlitchTip (Sentry protocol). Off unless `SENTRY_DSN` is set.
 * Uses the light `@sentry/node-core` SDK: errors only, no tracing or OpenTelemetry.
 */
let enabled = false

export function initErrorTracking(service: "web" | "worker" | "mcp") {
  const dsn = process.env.SENTRY_DSN
  if (!dsn || enabled) return
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? "production",
    serverName: service,
    initialScope: { tags: { service } },
    tracesSampleRate: 0,
    sendDefaultPii: false,
  })
  enabled = true
}

export function captureError(error: unknown, context?: Record<string, unknown>) {
  if (!enabled) return
  Sentry.captureException(error, context ? { extra: context } : undefined)
}

/** Waits for queued reports to be sent, e.g. before the process exits. */
export async function flushErrors(timeoutMs = 2000) {
  if (enabled) await Sentry.flush(timeoutMs)
}
