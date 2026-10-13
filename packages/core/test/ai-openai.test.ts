import http from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { chat } from "../src/ai"

/** chat() against a throwaway OpenAI-compatible server; no real provider or database involved. */
const servers: http.Server[] = []
afterEach(() => servers.splice(0).forEach((s) => s.close()))

async function provider(handler: (body: Record<string, unknown>) => { status?: number; json: unknown }) {
  const seen: Record<string, unknown>[] = []
  const srv = http.createServer((req, res) => {
    let raw = ""
    req.on("data", (c) => (raw += c))
    req.on("end", () => {
      const body = JSON.parse(raw)
      seen.push(body)
      const { status = 200, json } = handler(body)
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(json))
    })
  })
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r))
  servers.push(srv)
  const cfg = { provider: "openai", baseUrl: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`, model: "m", apiKey: "" } as never
  return { cfg, seen }
}
const reply = (content: string, finish_reason = "stop") => ({ choices: [{ message: { content }, finish_reason }] })
const ask = [{ role: "user" as const, content: "hi" }]

describe("chat (OpenAI-compatible)", () => {
  it("asks the model not to think", async () => {
    const { cfg, seen } = await provider(() => ({ json: reply('{"ok":true}') }))
    await chat(cfg, ask, { json: true })
    expect(seen[0].thinking).toEqual({ type: "disabled" })
    expect(seen[0].response_format).toEqual({ type: "json_object" })
  })

  it("retries without the optional fields on a 400 and remembers the host", async () => {
    const { cfg, seen } = await provider((b) => (b.thinking ? { status: 400, json: { error: "unknown field" } } : { json: reply("hi") }))
    expect(await chat(cfg, ask)).toBe("hi")
    expect(seen).toHaveLength(2)
    expect(await chat(cfg, ask)).toBe("hi")
    expect(seen).toHaveLength(3)
    expect(seen[2].thinking).toBeUndefined()
  })

  it("fails loudly when a reasoning model runs out of tokens before answering", async () => {
    const { cfg } = await provider(() => ({ json: reply("", "length") }))
    await expect(chat(cfg, ask, { json: true })).rejects.toThrow(/max_tokens/)
  })
})
