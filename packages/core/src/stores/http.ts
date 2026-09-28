import { StoreError } from "./types"

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** fetch with a timeout and retries on network errors, 429 and 5xx. */
export async function fetchWithRetry(url: string, init: RequestInit = {}, tries = 3, timeoutMs = 20_000): Promise<Response> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.status === 429 || res.status >= 500) {
        lastErr = new StoreError(`HTTP ${res.status} from ${new URL(url).hostname}`, res.status)
      } else {
        return res
      }
    } catch (e) {
      lastErr = e
    }
    if (attempt < tries) await sleep(1000 * 2 ** (attempt - 1))
  }
  throw lastErr instanceof Error ? lastErr : new StoreError(String(lastErr))
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetchWithRetry(url)
  if (!res.ok) throw new StoreError(`HTTP ${res.status} from ${new URL(url).hostname}`, res.status)
  return (await res.json()) as T
}
