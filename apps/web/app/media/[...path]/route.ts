import fs from "node:fs/promises"
import { resolveMediaPath } from "@lens/core"

/** Serves stored WebP images from MEDIA_DIR. Files are content-addressed, so they cache forever. */
export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params
  const rel = path.map(decodeURIComponent).join("/")
  const abs = /\.webp$/.test(rel) ? resolveMediaPath(rel) : null
  if (!abs) return new Response("Not found", { status: 404 })
  try {
    const data = await fs.readFile(abs)
    return new Response(new Uint8Array(data), {
      headers: { "content-type": "image/webp", "cache-control": "public, max-age=31536000, immutable" },
    })
  } catch {
    return new Response("Not found", { status: 404 })
  }
}
