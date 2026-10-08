import { NextResponse } from "next/server"
import { env, finishAppllamaConnect } from "@lens/core"

export const dynamic = "force-dynamic"

/** OAuth redirect target: exchanges the code for tokens and returns to Settings. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const back = (query: string) => NextResponse.redirect(`${env.publicUrl}/settings?${query}#appllama`)
  const denied = q.get("error")
  if (denied) return back(`appllama_error=${encodeURIComponent(q.get("error_description") || denied)}`)
  const code = q.get("code")
  const state = q.get("state")
  if (!code || !state) return back(`appllama_error=${encodeURIComponent("The authorization response was incomplete.")}`)
  try {
    await finishAppllamaConnect({ code, state })
    return back("connected=1")
  } catch (e) {
    return back(`appllama_error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`)
  }
}
