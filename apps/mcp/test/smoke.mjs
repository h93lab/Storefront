// Smoke test: node test/smoke.mjs http://localhost:3001/mcp <token>
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

const [url, token] = process.argv.slice(2)
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1) } else console.log("ok -", m) }

const bad = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
assert(bad.status === 401, "rejects requests without a token")

const client = new Client({ name: "smoke", version: "1" })
await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${token}` } } }))
const { tools } = await client.listTools()
assert(tools.length === 15, `lists ${tools.length} tools`)
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args })
  let data = null
  try { data = r.isError ? null : JSON.parse(r.content[0].text) } catch {}
  return { r, data }
}
const { data: apps } = await call("search_library")
assert(apps.length > 0, `search_library returns ${apps.length} apps`)
const id = apps[0].app_id
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
const { data: cmp } = await call("compare_apps", { app_ids: apps.slice(0, 2).map((a) => a.app_id) })
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
await client.close()

const viaPath = await fetch(`${url}/${token}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) })
assert(viaPath.status === 200, "secret-path auth works")
console.log("MCP smoke test passed")
