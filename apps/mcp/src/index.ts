import crypto from "node:crypto"
import http from "node:http"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { migrate } from "@lens/core/migrate"
import { buildServer } from "./tools"

const PORT = Number(process.env.MCP_PORT ?? 3001)
const TOKEN = process.env.MCP_TOKEN ?? ""
if (TOKEN.length < 24) {
  console.error("MCP_TOKEN must be set to a random string of at least 24 characters (see .env.example).")
  process.exit(1)
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

/**
 * Accepts `Authorization: Bearer <token>` or, for clients that cannot send
 * headers, a secret path `/mcp/<token>`.
 */
function authorised(req: http.IncomingMessage, pathname: string) {
  const header = req.headers.authorization ?? ""
  if (header.startsWith("Bearer ") && safeEqual(header.slice(7).trim(), TOKEN)) return true
  const m = pathname.match(/^\/mcp\/([^/]+)$/)
  if (!m) return false
  try {
    return safeEqual(decodeURIComponent(m[1]), TOKEN)
  } catch {
    return false // malformed percent-encoding
  }
}

async function readBody(req: http.IncomingMessage) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > 4 * 1024 * 1024) throw new Error("Request body too large")
    chunks.push(c)
  }
  const text = Buffer.concat(chunks).toString("utf8")
  return text ? JSON.parse(text) : undefined
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? "/", "http://x")
  if (pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}')
    return
  }
  if (!(pathname === "/mcp" || pathname.startsWith("/mcp/"))) {
    res.writeHead(404).end()
    return
  }
  if (!authorised(req, pathname)) {
    res.writeHead(401, { "content-type": "application/json", "www-authenticate": "Bearer" }).end('{"error":"unauthorized"}')
    return
  }
  if (req.method !== "POST") {
    // Stateless server: no standalone SSE stream or session teardown.
    res.writeHead(405, { allow: "POST" }).end()
    return
  }
  try {
    const body = await readBody(req)
    const mcp = buildServer()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on("close", () => {
      transport.close()
      mcp.close()
    })
    await mcp.connect(transport)
    await transport.handleRequest(req, res, body)
  } catch (e) {
    console.error(e)
    if (!res.headersSent) {
      res
        .writeHead(400, { "content-type": "application/json" })
        .end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: (e as Error).message }, id: null }))
    }
  }
})

await migrate(() => {})
server.listen(PORT, () => console.log(`MCP server listening on :${PORT}/mcp`))
process.on("unhandledRejection", (e) => console.error("unhandled rejection", e))
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => server.close(() => process.exit(0)))
