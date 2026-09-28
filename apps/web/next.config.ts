import path from "node:path"
import type { NextConfig } from "next"

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: ["@lens/core"],
  serverExternalPackages: ["sharp", "postgres", "google-play-scraper"],
  poweredByHeader: false,
}

export default config
