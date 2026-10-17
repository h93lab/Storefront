import type { Instrumentation } from "next"

// Server-side error reporting (GlitchTip). Imported lazily so the edge runtime never loads it.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const { initErrorTracking } = await import("@lens/core/errors")
  initErrorTracking("web")
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const { captureError } = await import("@lens/core/errors")
  captureError(error, { method: request.method, path: request.path, routePath: context.routePath, routeType: context.routeType })
}
