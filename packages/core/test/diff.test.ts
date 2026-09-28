import { describe, expect, it } from "vitest"
import { diffSnapshots, type SnapshotData } from "../src/diff"

const base: SnapshotData = {
  name: "Calm",
  description: "Sleep better tonight",
  releaseNotes: "Fixes",
  price: "Free",
  version: "1.0",
  iconHash: "i1",
  screenshots: ["a", "b", "c"],
}

describe("diffSnapshots", () => {
  it("returns nothing for identical snapshots (ignoring whitespace)", () => {
    expect(diffSnapshots(base, { ...base, description: " Sleep  better tonight " })).toEqual([])
  })
  it("detects each tracked field", () => {
    const next = {
      ...base,
      name: "Calm+",
      price: "$4.99",
      version: "1.1",
      description: "Sleep better every night",
      iconHash: "i2",
      screenshots: ["a", "d", "c"],
    }
    const fields = diffSnapshots(base, next).map((c) => c.field)
    expect(fields).toEqual(["name", "price", "version", "description", "icon", "screenshots"])
    const shots = diffSnapshots(base, next).find((c) => c.field === "screenshots")!
    expect(shots.summary).toBe("1 screenshot added, 1 removed (now 3)")
  })
  it("reports reordering and ignores release notes on version bumps", () => {
    expect(diffSnapshots(base, { ...base, screenshots: ["c", "b", "a"] })[0].summary).toBe("Screenshots reordered")
    expect(diffSnapshots(base, { ...base, version: "2.0", releaseNotes: "New" }).map((c) => c.field)).toEqual(["version"])
    expect(diffSnapshots(base, { ...base, releaseNotes: "Hotfix" }).map((c) => c.field)).toEqual(["release_notes"])
  })
  it("ignores an empty screenshot list (failed download)", () => {
    expect(diffSnapshots(base, { ...base, screenshots: [] })).toEqual([])
  })
})
