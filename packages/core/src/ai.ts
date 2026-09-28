import type { Settings } from "./settings"

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export class AiError extends Error {
  name = "AiError"
}

/** Minimal client for any OpenAI-compatible /chat/completions endpoint (OpenRouter, Ollama, vLLM, …). */
export async function chat(cfg: Settings["ai"], messages: ChatMessage[], opts: { json?: boolean; maxTokens?: number } = {}) {
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
