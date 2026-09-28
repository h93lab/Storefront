/** Snapshot of the fields we track for changes, stored daily per app. */
export interface SnapshotData {
  name: string
  description: string | null
  releaseNotes: string | null
  price: string | null
  version: string | null
  iconHash: string | null
  screenshots: string[] // screenshot hashes in store order (phone first)
}

export interface DetectedChange {
  field: "name" | "description" | "release_notes" | "price" | "version" | "icon" | "screenshots"
  oldValue: unknown
  newValue: unknown
  summary: string
}

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim()

function wordDelta(a: string, b: string) {
  const wa = new Set(norm(a).toLowerCase().split(" "))
  const wb = new Set(norm(b).toLowerCase().split(" "))
  let added = 0
  let removed = 0
  for (const w of wb) if (!wa.has(w)) added++
  for (const w of wa) if (!wb.has(w)) removed++
  return { added, removed }
}

export function diffSnapshots(prev: SnapshotData, next: SnapshotData): DetectedChange[] {
  const out: DetectedChange[] = []
  if (norm(prev.name) !== norm(next.name)) {
    out.push({ field: "name", oldValue: prev.name, newValue: next.name, summary: `Renamed from “${prev.name}” to “${next.name}”` })
  }
  if (norm(prev.price) !== norm(next.price)) {
    out.push({ field: "price", oldValue: prev.price, newValue: next.price, summary: `Price ${prev.price ?? "—"} → ${next.price ?? "—"}` })
  }
  if (norm(prev.version) !== norm(next.version) && next.version) {
    out.push({ field: "version", oldValue: prev.version, newValue: next.version, summary: `Version ${prev.version ?? "—"} → ${next.version}` })
  }
  if (norm(prev.description) !== norm(next.description)) {
    const { added, removed } = wordDelta(prev.description ?? "", next.description ?? "")
    out.push({
      field: "description",
      oldValue: prev.description,
      newValue: next.description,
      summary: `Description edited (${added} words added, ${removed} removed)`,
    })
  }
  // Release notes change on every version bump; record them only when the version did not change.
  if (norm(prev.releaseNotes) !== norm(next.releaseNotes) && norm(prev.version) === norm(next.version) && next.releaseNotes) {
    out.push({ field: "release_notes", oldValue: prev.releaseNotes, newValue: next.releaseNotes, summary: "Release notes updated" })
  }
  if (prev.iconHash && next.iconHash && prev.iconHash !== next.iconHash) {
    out.push({ field: "icon", oldValue: prev.iconHash, newValue: next.iconHash, summary: "App icon changed" })
  }
  const a = prev.screenshots
  const b = next.screenshots
  if (a.join() !== b.join() && b.length) {
    const added = b.filter((h) => !a.includes(h)).length
    const removed = a.filter((h) => !b.includes(h)).length
    const summary =
      added || removed
        ? `${added} screenshot${added === 1 ? "" : "s"} added, ${removed} removed (now ${b.length})`
        : "Screenshots reordered"
    out.push({ field: "screenshots", oldValue: a, newValue: b, summary })
  }
  return out
}
