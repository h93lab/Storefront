import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import { env } from "./env"
import { fetchWithRetry } from "./stores/http"

export interface StoredImage {
  hash: string
  path: string // relative to MEDIA_DIR
  width: number | null
  height: number | null
}

export async function downloadImage(url: string): Promise<Buffer> {
  const res = await fetchWithRetry(url, {}, 3, 30_000)
  if (!res.ok) throw new Error(`Image download failed (HTTP ${res.status}): ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

/**
 * Stores an image as WebP under MEDIA_DIR/<folder>/<sha256>.webp. Files are
 * content-addressed, so re-downloading an unchanged screenshot is a no-op.
 */
export async function storeImage(bytes: Buffer, folder: string, opts: { maxWidth?: number } = {}): Promise<StoredImage> {
  const hash = crypto.createHash("sha256").update(bytes).digest("hex")
  const rel = path.posix.join(folder, `${hash.slice(0, 32)}.webp`)
  const abs = path.join(env.mediaDir, rel)
  try {
    const meta = await sharp(abs).metadata()
    return { hash, path: rel, width: meta.width ?? null, height: meta.height ?? null }
  } catch {
    // not stored yet
  }
  await fs.mkdir(path.dirname(abs), { recursive: true })
  const { data, info } = await sharp(bytes)
    .rotate()
    .resize({ width: opts.maxWidth ?? 1290, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true })
  // Unique temp name: the same image can be stored twice at once (two URLs, same bytes).
  const tmp = `${abs}.${crypto.randomUUID()}.tmp`
  await fs.writeFile(tmp, data)
  await fs.rename(tmp, abs)
  return { hash, path: rel, width: info.width, height: info.height }
}

/** Resolves a stored relative path safely inside MEDIA_DIR (rejects traversal). */
export function resolveMediaPath(rel: string): string | null {
  const root = env.mediaDir
  const abs = path.resolve(/*turbopackIgnore: true*/ root, rel)
  return abs.startsWith(root + path.sep) ? abs : null
}

export const mediaUrl = (rel: string | null | undefined, base = "") => (rel ? `${base}/media/${rel}` : null)

export async function mediaUsageBytes(): Promise<number> {
  let total = 0
  async function walk(dir: string) {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) await walk(p)
      else total += (await fs.stat(p)).size
    }
  }
  await walk(env.mediaDir)
  return total
}
