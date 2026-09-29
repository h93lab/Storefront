import http from "node:http"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AiError, chat, embed, embeddingConfigured, parseJsonReply, testConnection } from "../src/ai"
import { normaliseItem } from "../src/analysis"
import { DEFAULT_SETTINGS } from "../src/settings"
import { startFakeAnthropic, type FakeAnthropic } from "./fake-anthropic"

describe("AI helpers", () => {
  it("parses JSON wrapped in fences or prose", () => {
    expect(parseJsonReply<{ a: number }>('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(parseJsonReply<{ a: number }>('Sure! {"a":2} hope that helps')).toEqual({ a: 2 })
    expect(() => parseJsonReply("nope")).toThrow(/not valid JSON/)
  })
  it("normalises classifier output to the fixed vocabularies", () => {
    expect(normaliseItem({ id: "1", sentiment: "negative", topic: "pricing", kind: "complaint", label: "Too expensive." })).toMatchObject({
      id: "1",
      sentiment: "negative",
      topic: "Pricing",
      kind: "complaint",
      label: "Too expensive",
      wtp_signal: "none",
      competitor: null,
      workaround: null,
      evidence: null,
      pain: 0,
    })
    expect(
      normaliseItem({ id: "2", sentiment: "angry" as never, topic: "weird", kind: "x" as never, wtp_signal: "maybe" as never }),
    ).toMatchObject({ sentiment: "neutral", topic: "Other", kind: "other", label: "", wtp_signal: "none" })
    expect(normaliseItem({})).toBeNull()
  })
  it("keeps opportunity signals only when they are well-formed", () => {
    const source = "Title\nI cancelled and went back to Headspace, it has offline mode"
    const item = normaliseItem(
      {
        id: "3",
        wtp_signal: "churned",
        competitor: "Headspace",
        workaround: "  downloads files by hand  ",
        evidence: "went back to Headspace",
        pain: 7,
      },
      source,
    )
    expect(item).toMatchObject({
      wtp_signal: "churned",
      competitor: "Headspace",
      workaround: "downloads files by hand",
      evidence: "went back to Headspace",
      pain: 5,
    })
    expect(item!.raw).toMatchObject({ id: "3", pain: 7 })
    // a paraphrased quote is dropped, the rest of the item is kept
    expect(normaliseItem({ id: "4", evidence: "switched to Headspace", pain: "2" as never }, source)).toMatchObject({
      evidence: null,
      pain: 2,
    })
    // without the source text the quote cannot be checked and is kept as is
    expect(normaliseItem({ id: "5", evidence: "anything" })!.evidence).toBe("anything")
    expect(normaliseItem({ id: "6", competitor: 42 as never, workaround: "" })).toMatchObject({ competitor: null, workaround: null })
    expect(normaliseItem({ id: "7", label: "x".repeat(100) })!.label).toHaveLength(80)
  })
})

describe("AI provider errors", () => {
  it("explains unreachable hosts and bad URLs", async () => {
    const { chat } = await import("../src/ai")
    const cfg = { ...DEFAULT_SETTINGS.ai, baseUrl: "http://127.0.0.1:59999/v1", model: "m", apiKey: "", autoAnalyse: true }
    await expect(chat(cfg, [{ role: "user", content: "hi" }])).rejects.toThrow(
      /Could not reach the AI provider at 127\.0\.0\.1:59999 \(ECONNREFUSED\)/,
    )
    await expect(chat({ ...cfg, baseUrl: "not a url" }, [{ role: "user", content: "hi" }])).rejects.toThrow(/not a valid URL/)
  })
})

describe("Anthropic provider", () => {
  let fake: FakeAnthropic
  beforeAll(async () => {
    fake = await startFakeAnthropic((system, user) => `echo:${system.slice(0, 5)}|${user}`)
  })
  afterAll(() => fake.close())
  const cfg = () => ({
    ...DEFAULT_SETTINGS.ai,
    provider: "anthropic" as const,
    baseUrl: fake.url,
    apiKey: "sk-test",
    model: "claude-haiku-4-5",
  })

  it("sends a cacheable system prompt and returns the text blocks", async () => {
    fake.requests.length = 0
    const text = await chat(cfg(), [
      { role: "system", content: "SYSTEM PROMPT" },
      { role: "user", content: "hello" },
    ])
    expect(text).toBe("echo:SYSTE|hello")
    const { body, path } = fake.requests[0]
    expect(path).toBe("/v1/messages")
    expect(body.model).toBe("claude-haiku-4-5")
    expect(body.max_tokens).toBe(4000)
    expect(body.system).toEqual([{ type: "text", text: "SYSTEM PROMPT", cache_control: { type: "ephemeral" } }])
    expect(body.messages).toEqual([{ role: "user", content: "hello" }])
    expect(body.temperature).toBeUndefined()
    expect(body.thinking).toBeUndefined()
  })

  it("asks for JSON only when json is set, and works with testConnection", async () => {
    fake.requests.length = 0
    await chat(cfg(), [{ role: "user", content: "data" }], { json: true, maxTokens: 50 })
    expect(fake.requests[0].body.messages[0].content).toBe("data\n\nRespond with JSON only.")
    expect(fake.requests[0].body.max_tokens).toBe(50)
    expect(fake.requests[0].body.system).toBeUndefined()
    expect((await testConnection(cfg())).reply).toContain("Reply with the JSON")
  })

  it("turns a refusal into an AiError", async () => {
    fake.refuse = true
    await expect(chat(cfg(), [{ role: "user", content: "x" }])).rejects.toThrow(new AiError("The model declined this request"))
    fake.refuse = false
  })

  it("explains configuration and HTTP errors", async () => {
    await expect(chat({ ...cfg(), model: "" }, [{ role: "user", content: "x" }])).rejects.toThrow(/not configured/)
    await expect(chat({ ...cfg(), baseUrl: "", apiKey: "" }, [{ role: "user", content: "x" }])).rejects.toThrow(/not configured/)
    // the fake has no /v1/other route, but /v1/messages under a wrong prefix is a 404
    await expect(chat({ ...cfg(), baseUrl: `${fake.url}/nope` }, [{ role: "user", content: "x" }])).rejects.toThrow(
      /HTTP 404\. Check the base URL and model name/,
    )
  })
})

describe("embed", () => {
  let server: http.Server
  let base = ""
  const seen: { path: string; body: any; auth?: string }[] = []
  beforeAll(async () => {
    server = http.createServer(async (req, res) => {
      let raw = ""
      for await (const c of req) raw += c
      const body = JSON.parse(raw)
      seen.push({ path: req.url ?? "", body, auth: req.headers.authorization })
      if (body.model === "bad") {
        res.statusCode = 401
        return res.end("nope")
      }
      // returned out of order on purpose: consumers must sort by index
      const data = (body.input as string[]).map((t, index) => ({ index, embedding: [t.length, index] })).reverse()
      res.setHeader("content-type", "application/json")
      res.end(JSON.stringify({ data }))
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  })
  afterAll(() => server.close())
  const cfg = () => ({ baseUrl: base, apiKey: "k", model: "m", dimensions: 2 })

  it("posts OpenAI-shaped requests in chunks of 100 and keeps the input order", async () => {
    seen.length = 0
    const texts = Array.from({ length: 150 }, (_, i) => "x".repeat(i + 1))
    const out = await embed(cfg(), texts, { inputType: "query" })
    expect(out).toHaveLength(150)
    expect(out[0]).toEqual([1, 0])
    expect(out[149]).toEqual([150, 49])
    expect(seen.map((s) => s.body.input.length)).toEqual([100, 50])
    expect(seen[0].path).toBe("/v1/embeddings")
    expect(seen[0].auth).toBe("Bearer k")
    expect(seen[0].body).toMatchObject({ model: "m", dimensions: 2 })
    expect(seen[0].body.input_type).toBeUndefined() // only sent to voyageai hosts
  })

  it("reports provider errors and missing configuration", async () => {
    await expect(embed({ ...cfg(), model: "bad" }, ["a"])).rejects.toThrow(/HTTP 401\. Check the API key/)
    await expect(embed({ ...cfg(), baseUrl: "" }, ["a"])).rejects.toThrow(/not configured/)
    expect(await embed(cfg(), [])).toEqual([])
  })

  it("knows when embeddings are configured", () => {
    expect(embeddingConfigured({ ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai, embedding: cfg() } })).toBe(true)
    expect(embeddingConfigured(DEFAULT_SETTINGS)).toBe(false)
  })
})
