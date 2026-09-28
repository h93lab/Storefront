import { activeJobs } from "@lens/core"

export const dynamic = "force-dynamic"

/** Queued and running jobs (optionally for one app). Polled by <JobWatcher>. */
export async function GET(req: Request) {
  const app = new URL(req.url).searchParams.get("app")
  if (app && !/^[0-9a-f-]{36}$/i.test(app)) return Response.json({ error: "Invalid app id" }, { status: 400 })
  const jobs = await activeJobs(app ?? undefined)
  return Response.json({ jobs }, { headers: { "cache-control": "no-store" } })
}
