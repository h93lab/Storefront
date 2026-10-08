import { NextResponse } from "next/server"
import { beginAppllamaConnect, env } from "@lens/core"

export const dynamic = "force-dynamic"

/** Starts the Appllama OAuth flow: registers the client once and sends the user to the authorize page. */
export async function GET() {
  try {
    const url = await beginAppllamaConnect(`${env.publicUrl}/api/appllama/callback`)
    return NextResponse.redirect(url)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.redirect(`${env.publicUrl}/settings?appllama_error=${encodeURIComponent(msg)}#appllama`)
  }
}
