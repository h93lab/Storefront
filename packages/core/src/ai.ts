import Anthropic from "@anthropic-ai/sdk"
import type { Settings } from "./settings"

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export class AiError extends Error {
  name = "AiError"
}

export interface ChatOptions {
  json?: boolean
  maxTokens?: number
}

/**
 * Sends a chat to the configured provider: the Anthropic Messages API when
 * `provider` is `anthropic`, otherwise any OpenAI-compatible /chat/completions
 * endpoint (OpenRouter, Ollama, vLLM, …).
 */
export async function chat(cfg: Settings["ai"], messages: ChatMessage[], opts: ChatOptions = {}) {
  if (cfg.provider === "anthropic") return chatAnthropic(cfg, messages, opts)
  return chatOpenAi(cfg, messages, opts)
}

async function chatOpenAi(cfg: Settings["ai"], messages: ChatMessage[], opts: ChatOptions) {
  if (!cfg.baseUrl || !cfg.model) throw new AiError("AI provider is not configured. Add a base URL and model in Settings.")
  const url = `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    temperature: 0.2,
    max_tokens: opts.maxTokens ?? 4000,
  }
  if (opts.json) body.response_format = { type: "json_object" }

  const host = (() => {
    try {
      return new URL(url).host
    } catch {
      throw new AiError(`The AI base URL "${cfg.baseUrl}" is not a valid URL.`)
    }
  })()
  const send = async (b: Record<string, unknown>) =>
    fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify(b),
      signal: AbortSignal.timeout(120_000),
    }).catch((e: Error & { cause?: { code?: string; message?: string } }) => {
      const reason = e.name === "TimeoutError" ? "timed out after 120s" : (e.cause?.code ?? e.cause?.message ?? e.message)
      throw new AiError(`Could not reach the AI provider at ${host} (${reason}). Check the base URL in Settings.`)
    })

  let res = await send(body)
  // Some providers reject response_format; retry once without it.
  if (res.status === 400 && opts.json) {
    delete body.response_format
    res = await send(body)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    const hint =
      res.status === 401 || res.status === 403 ? " Check the API key." : res.status === 404 ? " Check the base URL and model name." : ""
    throw new AiError(`AI provider returned HTTP ${res.status}.${hint} ${text.slice(0, 300)}`.trim())
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== "string") throw new AiError("AI provider returned no message content")
  return content
}

/** Extracts the first JSON object from a model reply (tolerates code fences and prose). */
export function parseJsonReply<T>(text: string): T {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim()
  try {
    return JSON.parse(cleaned) as T
  } catch {
    const start = cleaned.indexOf("{")
    const end = cleaned.lastIndexOf("}")
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as T
    throw new AiError("AI reply was not valid JSON")
  }
}

export async function testConnection(cfg: Settings["ai"]) {
  const started = Date.now()
  const reply = await chat(cfg, [{ role: "user", content: 'Reply with the JSON {"ok": true}' }], { json: true, maxTokens: 20 })
  return { ms: Date.now() - started, reply: reply.slice(0, 80) }
}

/* --------------------------------------------------------------- anthropic */

function anthropicClient(cfg: Settings["ai"]) {
  if (!cfg.model) throw new AiError("AI provider is not configured. Add a model in Settings.")
  if (!cfg.apiKey && !cfg.baseUrl) throw new AiError("AI provider is not configured. Add an API key in Settings.")
  return new Anthropic({ apiKey: cfg.apiKey || "not-set", baseURL: cfg.baseUrl || undefined, timeout: 120_000 })
}

/** Turns an SDK failure into an AiError with the same hints as the OpenAI-compatible path. */
function anthropicError(e: unknown, cfg: Settings["ai"]): AiError {
  if (e instanceof AiError) return e
  if (e instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiError("Could not reach the AI provider (timed out after 120s). Check the base URL in Settings.")
  }
  if (e instanceof Anthropic.APIConnectionError) {
    const cause = (e.cause as { code?: string; message?: string } | undefined) ?? {}
    const host = cfg.baseUrl ? ` at ${safeHost(cfg.baseUrl)}` : ""
    return new AiError(
      `Could not reach the AI provider${host} (${cause.code ?? cause.message ?? e.message}). Check the base URL in Settings.`,
    )
  }
  if (e instanceof Anthropic.APIError) {
    const status = e.status
    const hint = status === 401 || status === 403 ? " Check the API key." : status === 404 ? " Check the base URL and model name." : ""
    return new AiError(`AI provider returned HTTP ${status ?? "error"}.${hint} ${e.message}`.trim().slice(0, 400))
  }
  return new AiError((e as Error)?.message ?? String(e))
}

const safeHost = (u: string) => {
  try {
    return new URL(u).host
  } catch {
    return u
  }
}

const JSON_SUFFIX = "\n\nRespond with JSON only."

const cachedSystem = (text: string) => [{ type: "text" as const, text, cache_control: { type: "ephemeral" as const } }]

/**
 * Anthropic Messages API. The system prompt is marked cacheable; note that
 * Haiku 4.5 needs a prefix of at least 4096 tokens before caching kicks in,
 * while Sonnet 5.5 / Opus 5.5 need only 512, so caching mostly benefits the
 * larger models here. Replies are parsed with `parseJsonReply` (no structured outputs).
 */
async function chatAnthropic(cfg: Settings["ai"], messages: ChatMessage[], opts: ChatOptions) {
  const client = anthropicClient(cfg)
  const systemText = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n")
  const turns = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
  if (!turns.length) turns.push({ role: "user", content: "" })
  if (opts.json) {
    const last = turns[turns.length - 1]
    last.content += JSON_SUFFIX
  }
  let response: Anthropic.Message
  try {
    response = await client.messages.create({
      model: cfg.model,
      max_tokens: opts.maxTokens ?? 4000,
      ...(systemText ? { system: cachedSystem(systemText) } : {}),
      messages: turns,
    })
  } catch (e) {
    throw anthropicError(e, cfg)
  }
  if (response.stop_reason === "refusal") throw new AiError("The model declined this request")
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
  if (!text) throw new AiError("AI provider returned no message content")
  return text
}

/* ----------------------------------------------------------- message batches */

export interface BatchRequest {
  custom_id: string
  system: string
  user: string
  maxTokens: number
}
export interface BatchResult {
  custom_id: string
  ok: boolean
  text?: string
  error?: string
}

/** Submits requests to the Anthropic Message Batches API (50% cheaper, results within ~1h). Returns the provider batch id. */
export async function createBatch(cfg: Settings["ai"], requests: BatchRequest[]) {
  const client = anthropicClient(cfg)
  try {
    const batch = await client.messages.batches.create({
      requests: requests.map((r) => ({
        custom_id: r.custom_id,
        params: {
          model: cfg.model,
          max_tokens: r.maxTokens,
          system: cachedSystem(r.system),
          messages: [{ role: "user" as const, content: r.user + JSON_SUFFIX }],
        },
      })),
    })
    return batch.id
  } catch (e) {
    throw anthropicError(e, cfg)
  }
}

export async function retrieveBatch(cfg: Settings["ai"], id: string) {
  const client = anthropicClient(cfg)
  try {
    const b = await client.messages.batches.retrieve(id)
    return {
      status: (b.processing_status === "ended" ? "ended" : "in_progress") as "in_progress" | "ended",
      counts: b.request_counts,
    }
  } catch (e) {
    throw anthropicError(e, cfg)
  }
}

export async function* batchResults(cfg: Settings["ai"], id: string): AsyncGenerator<BatchResult> {
  const client = anthropicClient(cfg)
  let stream
  try {
    stream = await client.messages.batches.results(id)
  } catch (e) {
    throw anthropicError(e, cfg)
  }
  for await (const r of stream) {
    const res = r.result
    if (res.type === "succeeded") {
      const text = res.message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
      yield { custom_id: r.custom_id, ok: true, text }
    } else if (res.type === "errored") {
      const err = res.error as { error?: { message?: string }; message?: string }
      yield { custom_id: r.custom_id, ok: false, error: err.error?.message ?? err.message ?? "request errored" }
    } else {
      yield { custom_id: r.custom_id, ok: false, error: `request ${res.type}` }
    }
  }
}

/* -------------------------------------------------------------- embeddings */

export const embeddingConfigured = (s: Settings) => Boolean(s.ai.embedding.baseUrl && s.ai.embedding.model)

/**
 * Embeds texts through an OpenAI-shaped `/embeddings` endpoint (OpenAI, Voyage, Ollama, …).
 * Inputs are sent in chunks of 100. `input_type` is Voyage-specific and only sent to voyageai hosts.
 */
export async function embed(
  cfg: Settings["ai"]["embedding"],
  texts: string[],
  opts: { inputType?: "query" | "document" } = {},
): Promise<number[][]> {
  if (!cfg.baseUrl || !cfg.model) throw new AiError("Embeddings are not configured. Add a base URL and model in Settings.")
  const url = `${cfg.baseUrl.replace(/\/$/, "")}/embeddings`
  const host = safeHost(url)
  const out: number[][] = []
  for (let i = 0; i < texts.length; i += 100) {
    const chunk = texts.slice(i, i + 100)
    const body: Record<string, unknown> = { model: cfg.model, input: chunk }
    if (cfg.dimensions) body.dimensions = cfg.dimensions
    if (opts.inputType && cfg.baseUrl.includes("voyageai")) body.input_type = opts.inputType
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    }).catch((e: Error & { cause?: { code?: string; message?: string } }) => {
      const reason = e.name === "TimeoutError" ? "timed out after 120s" : (e.cause?.code ?? e.cause?.message ?? e.message)
      throw new AiError(`Could not reach the embeddings provider at ${host} (${reason}). Check the base URL in Settings.`)
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      const hint =
        res.status === 401 || res.status === 403 ? " Check the API key." : res.status === 404 ? " Check the base URL and model name." : ""
      throw new AiError(`Embeddings provider returned HTTP ${res.status}.${hint} ${text.slice(0, 300)}`.trim())
    }
    const data = (await res.json()) as { data?: { embedding?: number[]; index?: number }[] }
    const rows = [...(data.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    if (rows.length !== chunk.length || rows.some((r) => !Array.isArray(r.embedding))) {
      throw new AiError("Embeddings provider returned an unexpected response")
    }
    for (const r of rows) out.push(r.embedding!)
  }
  return out
}
