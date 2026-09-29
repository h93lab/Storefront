import http from "node:http"

/**
 * A fake Anthropic API: POST /v1/messages, POST /v1/messages/batches,
 * GET /v1/messages/batches/:id (first poll in_progress, then ended) and
 * GET /v1/messages/batches/:id/results (JSONL). `reply` produces the model text
 * for a (system, user) pair; the same function answers batch requests.
 */
export interface FakeAnthropic {
  url: string
  /** Every request received: method, path and parsed JSON body. */
  requests: { method: string; path: string; body: any }[]
  /** Set to make batch results come back as `errored`. */
  failBatches: boolean
  /** Set to make POST /v1/messages report a refusal. */
  refuse: boolean
  close: () => Promise<void>
}

const message = (text: string, stop_reason = "end_turn") => ({
  id: "msg_fake",
  type: "message",
  role: "assistant",
  model: "fake",
  content: stop_reason === "refusal" ? [] : [{ type: "text", text }],
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
})

const systemText = (system: unknown) =>
  Array.isArray(system) ? system.map((b: { text?: string }) => b.text ?? "").join("\n") : String(system ?? "")
const userText = (messages: { content: unknown }[]) => {
  const c = messages[messages.length - 1]?.content
  const text = typeof c === "string" ? c : JSON.stringify(c)
  return text.replace(/\n\nRespond with JSON only\.$/, "")
}

export async function startFakeAnthropic(reply: (system: string, user: string) => string): Promise<FakeAnthropic> {
  const batches = new Map<string, { requests: { custom_id: string; params: any }[]; polls: number }>()
  const fake = { requests: [], failBatches: false, refuse: false } as unknown as FakeAnthropic
  const server = http.createServer((req, res) => {
    handle(req, res).catch((e: Error) => {
      res.statusCode = 500
      res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: e.message } }))
    })
  })
  const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    let raw = ""
    for await (const c of req) raw += c
    const path = (req.url ?? "").split("?")[0]
    const body = raw ? JSON.parse(raw) : null
    fake.requests.push({ method: req.method ?? "", path, body })
    const send = (status: number, payload: unknown, type = "application/json") => {
      res.statusCode = status
      res.setHeader("content-type", type)
      res.end(typeof payload === "string" ? payload : JSON.stringify(payload))
    }
    const port = (server.address() as { port: number }).port
    const batchState = (id: string, ended: boolean, n: number) => ({
      id,
      type: "message_batch",
      processing_status: ended ? "ended" : "in_progress",
      request_counts: { processing: ended ? 0 : n, succeeded: ended ? n : 0, errored: 0, canceled: 0, expired: 0 },
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      ended_at: ended ? new Date().toISOString() : null,
      cancel_initiated_at: null,
      archived_at: null,
      results_url: ended ? `http://127.0.0.1:${port}/v1/messages/batches/${id}/results` : null,
    })

    if (req.method === "POST" && path === "/v1/messages") {
      if (fake.refuse) return send(200, message("", "refusal"))
      return send(200, message(reply(systemText(body.system), userText(body.messages))))
    }
    if (req.method === "POST" && path === "/v1/messages/batches") {
      const id = `msgbatch_${batches.size + 1}`
      batches.set(id, { requests: body.requests, polls: 0 })
      return send(200, batchState(id, false, body.requests.length))
    }
    const m = path.match(/^\/v1\/messages\/batches\/([^/]+)(\/results)?$/)
    if (req.method === "GET" && m && batches.has(m[1])) {
      const b = batches.get(m[1])!
      if (!m[2]) {
        b.polls++
        return send(200, batchState(m[1], b.polls > 1, b.requests.length))
      }
      const lines = b.requests.map((r) =>
        JSON.stringify({
          custom_id: r.custom_id,
          result: fake.failBatches
            ? { type: "errored", error: { type: "error", error: { type: "api_error", message: "boom" } } }
            : { type: "succeeded", message: message(reply(systemText(r.params.system), userText(r.params.messages))) },
        }),
      )
      return send(200, lines.join("\n") + "\n", "application/x-jsonl")
    }
    send(404, { type: "error", error: { type: "not_found_error", message: `no route ${req.method} ${path}` } })
  }
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  fake.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  fake.close = () => new Promise<void>((r) => server.close(() => r()))
  return fake
}

/** Classifier reply used by the batch tests: rating <= 2 (or none) is a paywall complaint, the rest praise. */
export function classifyReply(user: string) {
  const rows = JSON.parse(user) as { id: string; rating: number | null; text: string }[]
  return JSON.stringify({
    items: rows.map((r) => ({
      id: r.id,
      sentiment: r.rating !== null && r.rating >= 4 ? "positive" : "negative",
      topic: "Pricing",
      kind: r.rating === null ? "request" : r.rating <= 2 ? "complaint" : "praise",
      label: r.rating === null ? "Offline mode — sleep stories" : r.rating <= 2 ? "Paywall before trying content" : "Arabic narration",
      wtp_signal: r.text.includes("Headspace") ? "churned" : "none",
      competitor: r.text.includes("Headspace") ? "Headspace" : null,
      workaround: null,
      evidence: r.text.includes("Headspace") ? "went back to Headspace" : null,
      pain: r.rating !== null && r.rating <= 2 ? 4 : 0,
    })),
  })
}
