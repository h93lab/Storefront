import { activeJobs } from "@lens/core"

export const dynamic = "force-dynamic"

/** Queued and running jobs, optionally for one app or one opportunity. Polled by <JobWatcher>. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const app = q.get("app")
  const opp = q.get("opportunity")
  if (app && !/^[0-9a-f-]{36}$/i.test(app)) return Response.json({ error: "Invalid app id" }, { status: 400 })
  if (opp && !/^\d+$/.test(opp)) return Response.json({ error: "Invalid opportunity id" }, { status: 400 })
  let jobs = [...(await activeJobs(app ?? undefined))]
  if (opp) jobs = jobs.filter((j) => String((j as { opportunity_id?: string | null }).opportunity_id ?? "") === opp)
  return Response.json({ jobs }, { headers: { "cache-control": "no-store" } })
}
