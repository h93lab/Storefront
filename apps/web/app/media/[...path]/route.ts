import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import { resolveMediaPath } from "@lens/core"

const WIDTHS = new Set([240, 480, 960])
const HEADERS = { "content-type": "image/webp", "cache-control": "public, max-age=31536000, immutable" }

/**
 * Serves stored WebP images from MEDIA_DIR. `?w=240|480|960` returns a resized
 * copy, generated once and cached under MEDIA_DIR/.thumbs. Files are
 * content-addressed, so responses cache forever.
 */
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const segments = (await ctx.params).path
  const rel = segments.join("/")
  const abs = /\.webp$/.test(rel) && !segments.some((s) => s.startsWith(".")) ? resolveMediaPath(rel) : null
  if (!abs) return new Response("Not found", { status: 404 })
  const w = Number(new URL(req.url).searchParams.get("w"))
  try {
    if (!WIDTHS.has(w)) return new Response(new Uint8Array(await fs.readFile(abs)), { headers: HEADERS })
    const thumb = resolveMediaPath(`.thumbs/${w}/${rel}`)!
    try {
      return new Response(new Uint8Array(await fs.readFile(thumb)), { headers: HEADERS })
    } catch {
      const data = await sharp(abs).resize({ width: w, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer()
      await fs.mkdir(path.dirname(thumb), { recursive: true })
      const tmp = `${thumb}.${crypto.randomUUID()}.tmp`
      await fs.writeFile(tmp, data)
      await fs.rename(tmp, thumb)
      return new Response(new Uint8Array(data), { headers: HEADERS })
    }
  } catch {
    return new Response("Not found", { status: 404 })
  }
}
