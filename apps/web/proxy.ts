import { NextResponse, type NextRequest } from "next/server"

/**
 * Optional HTTP Basic Auth for the web UI. Cloudflare Access is the main
 * protection; set BASIC_AUTH_USER and BASIC_AUTH_PASSWORD for a second layer
 * (or when the UI is exposed without Access).
 */
export function proxy(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER
  const pass = process.env.BASIC_AUTH_PASSWORD
  if (!user || !pass || req.nextUrl.pathname === "/api/health") return NextResponse.next()
  const header = req.headers.get("authorization") ?? ""
  if (header.startsWith("Basic ")) {
    const [u, ...rest] = atob(header.slice(6)).split(":")
    if (u === user && rest.join(":") === pass) return NextResponse.next()
  }
  return new NextResponse("Authentication required", { status: 401, headers: { "www-authenticate": 'Basic realm="Storefront Lens"' } })
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] }
