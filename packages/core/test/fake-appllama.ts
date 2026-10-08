import crypto from "node:crypto"
import http from "node:http"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import sharp from "sharp"
import { z } from "zod"

/**
 * A fake Appllama: an MCP server over Streamable HTTP (bearer-protected, like apps/mcp) with search_apps, get_app,
 * list_app_screens (10 per page, images served at /media/<id>.png), get_credits and list_my_boards, plus the OAuth
 * endpoints (metadata, dynamic registration, authorize, token with PKCE check, revoke).
 */
export interface FakeAppllama {
  /** Value for `settings.appllama.mcpUrl`. */
  mcpUrl: string
  base: string
  /** Every tool call received: tool name, arguments and the bearer token used. */
  calls: { tool: string; args: Record<string, any>; token: string }[]
  registrations: any[]
  tokenRequests: Record<string, string>[]
  revoked: string[]
  /** Bearer tokens the MCP endpoint accepts. */
  validTokens: Set<string>
  /** Make the next MCP request fail with this HTTP status (once). */
  failNext: number | null
  expiresIn: number
  close: () => Promise<void>
}

const CALM = "571800810"
const OTHER = "389801252"

const iap = [
  { title: "Calm Premium Monthly", duration: "Monthly", price: 14.99 },
  { title: "Calm Premium Annual", duration: "Annual", price: 69.99 },
  { title: "Calm Premium Annual (offer)", duration: "Annual", price: 49.99 },
  { title: "Weekly pass", duration: "Weekly", price: 4.99 },
  { title: "Calm Lifetime", duration: "Unknown", price: 399.99 },
  { title: "Tip jar", duration: "Unknown", price: 1.99 },
]

const summary = (id: string, name: string, screens: number, extra: Record<string, unknown> = {}) => ({
  app_id: id,
  name,
  subtitle: `${name} subtitle`,
  publisher: `${name} Inc`,
  categories: ["Health & Fitness"],
  rating: { average: 3.7, count: 1_900_000 },
  category_rank: { rank: 4, category: "Health & Fitness" },
  revenue: { display: "$4.2M", monthly_usd: 4_200_000, as_of: "2026-09-01" },
  downloads: { display: "1.2M", value: 1_200_000 },
  in_app_purchases: id === CALM ? iap : [{ title: "Pro Monthly", duration: "Monthly", price: 9.99 }],
  launched: "2012-05-01",
  last_updated: "2026-09-20",
  screens_count: screens,
  videos_count: id === CALM ? 1 : 0,
  flows: [{ name: "Onboarding", screens: 6 }],
  ...extra,
})

const APPS: Record<string, { summary: ReturnType<typeof summary>; total: number }> = {
  [CALM]: { summary: summary(CALM, "Calm", 15), total: 15 },
  [OTHER]: { summary: summary(OTHER, "Sleepy", 12), total: 12 },
}

/** Screen n of an app. Sections are deliberately interleaved so the order has to be restored by the reader. */
const sections = ["paywall", "other-tabs", "onboarding", "welcome-screen"]
function screenOf(appId: string, n: number, base: string) {
  const section = sections[n % sections.length]
  const video = appId === CALM && n === 14
  return {
    screen_id: `${appId}-s${n}`,
    name: `Screen ${n}`,
    flow: section === "onboarding" ? "Onboarding" : "Main",
    section,
    position: Math.floor(n / sections.length),
    kind: video ? "video" : "image",
    media_url: `${base}/media/${appId}-s${n}.png`,
    width: 390,
    height: 844,
    duration_ms: video ? 4000 : null,
    dominant_color: "#336699",
    colors: ["#336699", "#ffffff"],
    ui_elements: ["button", "tab bar"],
  }
}

const json = (res: http.ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body))

async function readRaw(req: http.IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks).toString("utf8")
}

export async function startFakeAppllama(): Promise<FakeAppllama> {
  const fake = {
    calls: [],
    registrations: [],
    tokenRequests: [],
    revoked: [],
    validTokens: new Set(["good-token", "good-token-2"]),
    failNext: null,
    expiresIn: 3600,
  } as unknown as FakeAppllama
  const challenges = new Map<string, string>() // code -> code_challenge
  let base = ""

  const buildServer = (token: string) => {
    const mcp = new McpServer({ name: "fake-appllama", version: "1" })
    const reply = (tool: string, args: Record<string, any>, payload: unknown) => {
      fake.calls.push({ tool, args, token })
      return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] }
    }
    const credits = { spent: 0, remaining_this_month: 1000 }
    mcp.registerTool(
      "search_apps",
      { description: "search", inputSchema: { query: z.string().optional(), cursor: z.string().optional(), sort: z.string().optional() } },
      async (args) => {
        const q = (args.query ?? "").toLowerCase()
        const apps = Object.values(APPS)
          .map((a) => a.summary)
          .filter((a) => a.name.toLowerCase().includes(q))
        return reply("search_apps", args, { apps, total: apps.length, next_cursor: null, credits })
      },
    )
    mcp.registerTool("get_app", { description: "app", inputSchema: { app_id: z.string() } }, async (args) => {
      const a = APPS[args.app_id]
      if (!a) return { isError: true, content: [{ type: "text" as const, text: "App not found" }] }
      return reply("get_app", args, {
        ...a.summary,
        description: `${a.summary.name} description`,
        current_version: "1.0",
        publisher_country: "US",
        ratings_breakdown: { "1": 1, "2": 2, "3": 3, "4": 4, "5": 5 },
        top_countries: ["US", "GB"],
        languages: ["en"],
        sections: [{ section: "onboarding", label: "Onboarding" }],
        hint: "ignore me",
        credits,
      })
    })
    mcp.registerTool(
      "list_app_screens",
      { description: "screens", inputSchema: { app_id: z.string(), cursor: z.string().optional() } },
      async (args) => {
        const a = APPS[args.app_id]
        if (!a) return { isError: true, content: [{ type: "text" as const, text: "App not found" }] }
        const start = args.cursor ? Number(args.cursor) : 0
        const end = Math.min(start + 10, a.total)
        const screens = Array.from({ length: end - start }, (_, i) => screenOf(args.app_id, start + i, base))
        return reply("list_app_screens", args, {
          app: { app_id: args.app_id, name: a.summary.name },
          screens,
          total: a.total,
          next_cursor: end < a.total ? String(end) : null,
        })
      },
    )
    mcp.registerTool("get_credits", { description: "credits", inputSchema: {} }, async (args) =>
      reply("get_credits", args, {
        period_start: "2026-10-01",
        resets_on: "2026-11-01",
        monthly_credits: 1500,
        bonus_credits: 0,
        used: 500,
        remaining: 1000,
        limits: { per_minute: 90, per_day: 400 },
      }),
    )
    mcp.registerTool("list_my_boards", { description: "boards", inputSchema: {} }, async (args) =>
      reply("list_my_boards", args, { boards: [{ board_id: "b1", name: "Sleep apps", kind: "apps", item_count: 2 }] }),
    )
    return mcp
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x")
      const path = url.pathname
      if (path === "/.well-known/oauth-authorization-server") {
        return json(res, 200, {
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          revocation_endpoint: `${base}/revoke`,
          scopes_supported: ["appllama"],
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
          code_challenge_methods_supported: ["S256"],
        })
      }
      if (path === "/register" && req.method === "POST") {
        fake.registrations.push(JSON.parse(await readRaw(req)))
        return json(res, 201, { client_id: "client-1", client_secret: "secret-1" })
      }
      if (path === "/authorize") {
        const code = `code-${challenges.size + 1}`
        challenges.set(code, url.searchParams.get("code_challenge") ?? "")
        const back = new URL(url.searchParams.get("redirect_uri") ?? "http://localhost/cb")
        back.searchParams.set("code", code)
        back.searchParams.set("state", url.searchParams.get("state") ?? "")
        res.writeHead(302, { location: back.toString() }).end()
        return
      }
      if (path === "/token" && req.method === "POST") {
        const form = Object.fromEntries(new URLSearchParams(await readRaw(req)))
        fake.tokenRequests.push(form)
        if (form.client_id !== "client-1" || form.client_secret !== "secret-1") return json(res, 401, { error: "invalid_client" })
        if (form.grant_type === "authorization_code") {
          const challenge = challenges.get(form.code)
          const ok =
            challenge &&
            crypto
              .createHash("sha256")
              .update(form.code_verifier ?? "")
              .digest("base64url") === challenge
          if (!ok) return json(res, 400, { error: "invalid_grant", error_description: "PKCE verification failed" })
          challenges.delete(form.code)
          return json(res, 200, {
            access_token: "good-token",
            refresh_token: "refresh-1",
            token_type: "Bearer",
            expires_in: fake.expiresIn,
            scope: "appllama",
          })
        }
        if (form.grant_type === "refresh_token" && form.refresh_token?.startsWith("refresh-")) {
          return json(res, 200, { access_token: "good-token-2", refresh_token: "refresh-2", token_type: "Bearer", expires_in: 3600 })
        }
        return json(res, 400, { error: "invalid_grant" })
      }
      if (path === "/revoke" && req.method === "POST") {
        const form = Object.fromEntries(new URLSearchParams(await readRaw(req)))
        fake.revoked.push(form.token)
        return json(res, 200, {})
      }
      const media = path.match(/^\/media\/(.+)\.png$/)
      if (media) {
        let h = 0
        for (const ch of media[1]) h = (h * 31 + ch.charCodeAt(0)) % 200
        const png = await sharp({ create: { width: 390, height: 844, channels: 3, background: { r: h, g: 120, b: 255 - h } } })
          .png()
          .toBuffer()
        return void res.writeHead(200, { "content-type": "image/png" }).end(png)
      }
      if (path === "/mcp") {
        const header = req.headers.authorization ?? ""
        const token = header.startsWith("Bearer ") ? header.slice(7) : ""
        if (fake.failNext) {
          const status = fake.failNext
          fake.failNext = null
          return json(res, status, { error: "forced" })
        }
        if (!fake.validTokens.has(token)) {
          return void res
            .writeHead(401, { "content-type": "application/json", "www-authenticate": "Bearer" })
            .end('{"error":"unauthorized"}')
        }
        if (req.method !== "POST") return void res.writeHead(405, { allow: "POST" }).end()
        const body = JSON.parse(await readRaw(req))
        const mcp = buildServer(token)
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
        res.on("close", () => {
          transport.close()
          mcp.close()
        })
        await mcp.connect(transport)
        await transport.handleRequest(req, res, body)
        return
      }
      res.writeHead(404).end()
    } catch (e) {
      if (!res.headersSent) json(res, 500, { error: (e as Error).message })
    }
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  fake.base = base
  fake.mcpUrl = `${base}/mcp`
  fake.close = () => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r())))
  return fake
}

export const FAKE_APP_IDS = { calm: CALM, other: OTHER }
