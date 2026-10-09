import { NextResponse, type NextRequest } from "next/server"
import { SESSION_COOKIE, sessionSecret, verifySession } from "@/lib/session"

/**
 * Gate for the whole web UI: everything except the login pages, health check and static assets needs a validly
 * signed, unexpired `lens_session` cookie. This only checks the signature (no database here, and no @lens/core:
 * it would pull in `postgres`); the password-epoch check happens in the app layout via requireSession().
 */
const PUBLIC = ["/login", "/setup", "/api/health", "/api/auth", "/_next", "/favicon.ico"]
const isPublic = (path: string) => PUBLIC.some((p) => path === p || path.startsWith(`${p}/`))

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  if (isPublic(pathname)) return NextResponse.next()
  let secret: string
  try {
    secret = sessionSecret()
  } catch (e) {
    return new NextResponse((e as Error).message, { status: 500 })
  }
  if (await verifySession(req.cookies.get(SESSION_COOKIE)?.value, secret)) return NextResponse.next()
  const machine = pathname.startsWith("/api/") || pathname.startsWith("/media/") || req.headers.has("next-action")
  if (machine) return Response.json({ error: "Authentication required" }, { status: 401 })
  const url = req.nextUrl.clone()
  url.pathname = "/login"
  url.search = ""
  if (pathname !== "/") url.searchParams.set("next", pathname + search)
  return NextResponse.redirect(url)
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] }
