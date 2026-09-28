import { NextResponse } from "next/server"
import { storeClient } from "@lens/core"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const store = url.searchParams.get("store")
  const term = url.searchParams.get("term")?.trim()
  const country = (url.searchParams.get("country") ?? "us").toLowerCase()
  if ((store !== "ios" && store !== "android") || !term) {
    return NextResponse.json({ error: "Pass store=ios|android and a search term." }, { status: 400 })
  }
  if (!/^[a-z]{2}$/.test(country)) return NextResponse.json({ error: "Invalid country" }, { status: 400 })
  try {
    const results = await storeClient(store).search(term, country, "en", 12)
    return NextResponse.json({ results })
  } catch (e) {
    return NextResponse.json({ error: `Store search failed: ${(e as Error).message}` }, { status: 502 })
  }
}
