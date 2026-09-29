import { enqueue } from "./jobs"
import { importItems, type ItemInput } from "./opportunities"
import { getSettings } from "./settings"

/**
 * Reddit source. Responsible Builder Policy: the Data API is for personal,
 * non-commercial use unless Reddit approves otherwise. This fetcher uses an
 * app-only token, identifies itself with the configured User-Agent, and paces
 * requests at one per 700 ms (far below the 100/min limit). Do not raise the
 * rate or add parallelism.
 */
const PACE_MS = 700
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t)
        reject(signal.reason)
      },
      { once: true },
    )
  })

interface RedditPost {
  id?: string
  title?: string
  selftext?: string
  permalink?: string
  author?: string
  created_utc?: number
}

export async function fetchReddit(
  opts: {
    log?: (m: string) => void
    onProgress?: (m: string) => void
    signal?: AbortSignal
    fetchImpl?: typeof fetch
  } = {},
): Promise<{ fetched: number; inserted: number; skipped: number }> {
  const { reddit } = await getSettings()
  const log = opts.log ?? (() => {})
  const doFetch = opts.fetchImpl ?? fetch
  const empty = { fetched: 0, inserted: 0, skipped: 0 }
  if (!reddit.enabled || !reddit.clientId || !reddit.clientSecret || !reddit.userAgent) return empty
  if (!reddit.subreddits.length || !reddit.keywords.length) return empty

  const testBase = reddit.apiBase.replace(/\/$/, "")
  const apiBase = testBase || "https://oauth.reddit.com"
  const authBase = testBase || "https://www.reddit.com"
  const headers = { "user-agent": reddit.userAgent }
  let requests = 0

  const tokenRes = await doFetch(`${authBase}/api/v1/access_token`, {
    method: "POST",
    headers: {
      ...headers,
      authorization: `Basic ${Buffer.from(`${reddit.clientId}:${reddit.clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: opts.signal,
  })
  requests++
  if (tokenRes.status === 401 || tokenRes.status === 403) {
    throw new Error("Reddit refused the credentials — check the app's client id/secret and that the app type is 'script'")
  }
  if (!tokenRes.ok) throw new Error(`Reddit token request failed with HTTP ${tokenRes.status}`)
  const token = ((await tokenRes.json().catch(() => null)) as { access_token?: string } | null)?.access_token
  if (!token) throw new Error("Reddit returned no access token — check the app's client id/secret and that the app type is 'script'")

  const items: ItemInput[] = []
  const seen = new Set<string>()
  let fetched = 0
  const total = reddit.subreddits.length * reddit.keywords.length
  for (const sub of reddit.subreddits) {
    for (const keyword of reddit.keywords) {
      opts.signal?.throwIfAborted()
      if (!testBase && requests > 0) await sleep(PACE_MS, opts.signal)
      opts.onProgress?.(`Reddit ${requests}/${total}: r/${sub} “${keyword}”`)
      const qs = new URLSearchParams({ q: keyword, restrict_sr: "1", sort: "new", t: "month", limit: String(reddit.limit) })
      const res = await doFetch(`${apiBase}/r/${encodeURIComponent(sub)}/search?${qs}`, {
        headers: { ...headers, authorization: `Bearer ${token}` },
        signal: opts.signal,
      })
      requests++
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `Reddit refused the request for r/${sub} (HTTP ${res.status}) — the subreddit may be private or the app lacks access`,
        )
      }
      if (!res.ok) {
        log(`r/${sub} "${keyword}": HTTP ${res.status}, skipped`)
        continue
      }
      const data = (await res.json().catch(() => null)) as { data?: { children?: { data?: RedditPost }[] } } | null
      for (const child of data?.data?.children ?? []) {
        const p = child.data
        if (!p) continue
        fetched++
        const text = (p.selftext ?? "").trim()
        const key = p.id ?? p.permalink ?? ""
        if (!text || !p.permalink || seen.has(key)) continue
        seen.add(key)
        items.push({
          source: "reddit",
          body: `${(p.title ?? "").trim()}\n\n${text}`,
          url: `https://www.reddit.com${p.permalink}`,
          author: p.author ?? null,
          postedAt: typeof p.created_utc === "number" ? new Date(p.created_utc * 1000) : null,
        })
      }
    }
  }
  log(`reddit: ${requests} requests, ${fetched} posts, ${items.length} with text`)
  const { inserted } = await importItems(items)
  if (inserted > 0) await enqueue("analyse_items")
  return { fetched, inserted, skipped: fetched - inserted }
}
