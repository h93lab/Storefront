import path from "node:path"

export const env = {
  get databaseUrl() {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.")
    return url
  },
  get mediaDir() {
    return path.resolve(process.env.MEDIA_DIR ?? "./data/media")
  },
  /** Public base URL of the web app, used to build absolute media links for MCP clients. */
  get publicUrl() {
    return (process.env.PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "")
  },
  get timezone() {
    return process.env.TZ ?? "UTC"
  },
}
