// Smoke test: node test/smoke.mjs http://localhost:3001/mcp <token>
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

const [url, token] = process.argv.slice(2)
const assert = (c, m) => {
  if (!c) {
    console.error("FAIL:", m)
    process.exit(1)
  } else console.log("ok -", m)
}

const bad = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
assert(bad.status === 401, "rejects requests without a token")

const client = new Client({ name: "smoke", version: "1" })
await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${token}` } } }))
const { tools } = await client.listTools()
assert(tools.length === 29, `lists ${tools.length} tools`)
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args })
  let data = null
  try {
    data = r.isError ? null : JSON.parse(r.content[0].text)
  } catch {}
  return { r, data }
}
const { data: apps } = await call("search_library")
assert(apps.length > 0, `search_library returns ${apps.length} apps`)
const id = apps.find((a) => a.status === "ready").app_id
const { data: app } = await call("get_app", { app_id: id })
assert(app.name && app.description, `get_app returns ${app.name}`)
const { data: shots } = await call("get_screenshots", { app_id: id, include_previous: true })
assert(shots.length > 0 && shots.some((s) => !s.current), "get_screenshots includes previous screens")
const { r: img } = await call("view_screenshot", { screenshot_id: shots[0].screenshot_id })
assert(img.content[1]?.type === "image" && img.content[1].data.length > 1000, "view_screenshot returns image data")
const { data: rev } = await call("get_reviews", { app_id: id, rating: "neg", limit: 5 })
assert(rev.returned > 0 && rev.reviews.every((x) => x.rating <= 2), "get_reviews filters by rating")
const { data: ins } = await call("get_insights", { app_id: id })
assert(ins.complaints.length > 0, "get_insights returns complaints")
const { data: ch } = await call("get_changes", { days: 30 })
assert(ch.length > 0, `get_changes returns ${ch.length} changes`)
const { data: cmp } = await call("compare_apps", {
  app_ids: apps
    .filter((a) => a.status === "ready")
    .slice(0, 2)
    .map((a) => a.app_id),
})
assert(cmp.length === 2, "compare_apps compares two apps")
const { data: board } = await call("create_board", { name: "Smoke board" })
const { data: saved } = await call("save_to_board", { board_id: board.board_id, screenshot_id: shots[0].screenshot_id, note: "from smoke" })
assert(saved.saved, "save_to_board saves a screenshot")
const { data: saved2 } = await call("save_to_board", { board_id: board.board_id, app_id: id, review_id: rev.reviews[0].review_id })
assert(saved2.saved, "save_to_board saves a review")
const { data: b } = await call("get_board", { board_id: board.board_id })
assert(b.items.length === 2, "get_board lists both items")
const { r: missing } = await call("get_app", { app_id: "00000000-0000-0000-0000-000000000000" })
assert(missing.isError, "unknown app returns a tool error")
const { r: badLink } = await call("add_app", { link_or_id: "not a link" })
assert(badLink.isError, "add_app rejects invalid links")
const { data: added } = await call("add_app", { link_or_id: "https://apps.apple.com/eg/app/x/id1234567890" })
assert(added.status === "sync queued", "add_app queues a sync")

const { data: imp } = await call("import_items", {
  items: [
    { body: "I wish there was a way to export my streak history to CSV. Smoke test." },
    { body: "  i wish there was a way to export my streak   history to csv. smoke test. " },
  ],
})
assert(imp.inserted + imp.skipped === 2 && imp.skipped >= 1, `import_items skips the duplicate (${JSON.stringify(imp)})`)
const { data: found } = await call("search_reviews", { signal: "any", limit: 5 })
assert(Array.isArray(found.evidence) && typeof found.total === "number", "search_reviews with signal any returns evidence")
const { data: opps } = await call("list_opportunities", { status: "all", own: "all" })
assert(Array.isArray(opps) && opps.length > 0, `list_opportunities returns ${opps.length} opportunities`)
const oid = opps[0].id
const { data: opp } = await call("get_opportunity", { opportunity_id: oid, limit: 5 })
assert(opp.evidence.length > 0 && opp.evidence.length <= 5 && opp.labels.length > 0, "get_opportunity returns evidence and labels")
const { r: badGate } = await call("save_gate_result", { opportunity_id: oid, checks: { scope: true, nonsense: true } })
assert(badGate.isError, "save_gate_result rejects an unknown key")
const { data: gate } = await call("save_gate_result", { opportunity_id: oid, checks: { scope: true, permissions: false }, notes: "smoke" })
assert(gate.checks.scope === true && gate.checks.permissions === false, "save_gate_result saves checks")
const { data: st } = await call("set_opportunity_status", { opportunity_id: oid, status: "validating" })
assert(st.status === "validating", "set_opportunity_status updates the status")
const { data: out } = await call("record_outcome", { opportunity_id: oid, installs: 120, trial_starts: 4, paying: 1 })
assert(out.installs === 120, "record_outcome saves the outcome")
const { data: sp } = await call("save_spec", { opportunity_id: oid, spec_md: "## 1. Problem\nSmoke spec" })
assert(sp.saved, "save_spec saves the spec")
const { data: after } = await call("get_opportunity", { opportunity_id: oid, limit: 1 })
assert(
  after.status === "validating" &&
    after.spec_md?.includes("Smoke spec") &&
    after.outcome?.paying === 1 &&
    after.gate?.checks?.scope === true,
  "get_opportunity reflects the saved state",
)
const { data: queue } = await call("get_review_queue", { limit: 5 })
assert(Array.isArray(queue), `get_review_queue returns ${queue?.length} rows`)
if (queue.length) {
  const { data: vd } = await call("record_verdict", { source: queue[0].source, ref: queue[0].ref, verdict: "correct" })
  assert(vd?.verdict === "correct", "record_verdict records a verdict")
  const { data: acc } = await call("get_accuracy")
  assert(acc.total >= 1, `get_accuracy total ${acc.total}`)
  const { r: badVerdict } = await call("record_verdict", { source: queue[0].source, ref: queue[0].ref, verdict: "maybe" })
  assert(badVerdict.isError, "record_verdict rejects an invalid verdict")
} else console.log("skip - no review queue rows")
const { data: val0 } = await call("get_validation", { opportunity_id: oid })
assert(["pending", "proceed", "kill"].includes(val0.decision), `get_validation decision ${val0.decision}`)
const { data: vm } = await call("save_validation_metrics", { opportunity_id: oid, waitlist: 25 })
assert(vm.decision === "proceed", "save_validation_metrics returns proceed at 25 sign-ups")
const { data: val1 } = await call("get_validation", { opportunity_id: oid })
assert(val1.decision === "proceed" && val1.metrics.waitlist === 25, "get_validation reflects saved metrics")
const { data: sim } = await call("similar_opportunities", { opportunity_id: oid })
assert(Array.isArray(sim), "similar_opportunities returns an array")
const { r: noOpp } = await call("get_opportunity", { opportunity_id: 999999 })
assert(noOpp.isError, "unknown opportunity returns a tool error")
await client.close()

const viaPath = await fetch(`${url}/${token}`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
})
assert(viaPath.status === 200, "secret-path auth works")
console.log("MCP smoke test passed")
