import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import sharp from "sharp"
import { describe, expect, it } from "vitest"

describe("storeImage", () => {
  it("stores the same image concurrently without failing", async () => {
    process.env.MEDIA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "lens-media-race-"))
    const { storeImage } = await import("../src/media")
    const png = await sharp({ create: { width: 300, height: 600, channels: 3, background: "#123456" } })
      .png()
      .toBuffer()
    const results = await Promise.all(Array.from({ length: 12 }, () => storeImage(png, "app/screens")))
    expect(new Set(results.map((r) => r.path)).size).toBe(1)
    const files = await fs.readdir(path.join(process.env.MEDIA_DIR, "app/screens"))
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([])
  })
})
