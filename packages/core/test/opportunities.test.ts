import { describe, expect, it } from "vitest"
import { opportunityScore, validateGrouping, type UnmappedLabel } from "../src/opportunities"

const batch: UnmappedLabel[] = [
  { label: "offline mode — sleep stories", count: 5, kind: "request" },
  { label: "paywall before trying content", count: 9, kind: "complaint" },
  { label: "dark mode", count: 2, kind: "request" },
  { label: "forgotten label", count: 1, kind: "complaint" },
]

describe("validateGrouping", () => {
  it("drops unknown ids and labels, and groups forgotten labels on their own", () => {
    const res = validateGrouping(
      {
        map: [
          { label: "Offline Mode — Sleep Stories ", opportunity_id: 7 },
          { label: "paywall before trying content", opportunity_id: 999 }, // unknown id
          { label: "not in the batch", opportunity_id: 7 },
        ],
        new: [{ label: "Free sample — before paywall", kind: "complaint", labels: ["paywall before trying content", "made up"] }],
      },
      batch,
      new Set([7]),
    )
    expect([...res.map]).toEqual([["offline mode — sleep stories", 7]])
    expect(res.groups).toEqual([
      { label: "Free sample — before paywall", kind: "complaint", labels: ["paywall before trying content"] },
      { label: "dark mode", kind: "request", labels: ["dark mode"] },
      { label: "forgotten label", kind: "complaint", labels: ["forgotten label"] },
    ])
  })

  it("uses every label exactly once", () => {
    const res = validateGrouping(
      {
        map: [
          { label: "dark mode", opportunity_id: 1 },
          { label: "dark mode", opportunity_id: 2 },
        ],
        new: [
          { label: "x".repeat(100), kind: "bogus", labels: ["dark mode", "offline mode — sleep stories", "offline mode — sleep stories"] },
        ],
      },
      batch,
      new Set([1, 2]),
    )
    const used = [...res.map.keys(), ...res.groups.flatMap((g) => g.labels)]
    expect(used.sort()).toEqual(batch.map((b) => b.label).sort())
    expect(new Set(used).size).toBe(batch.length)
    expect(res.map.get("dark mode")).toBe(1)
    expect(res.groups[0].label).toHaveLength(60)
    expect(res.groups[0].kind).toBe("request") // invalid kind falls back to the members' majority
  })

  it("treats a malformed reply as empty", () => {
    for (const bad of [null, "text", 5, [], { map: "x", new: 3 }]) {
      const res = validateGrouping(bad, batch, new Set())
      expect(res.map.size).toBe(0)
      expect(res.groups).toHaveLength(batch.length)
    }
  })
})

describe("opportunityScore", () => {
  it("multiplies recency, listing spread, pain and willingness to pay", () => {
    // 10 * (1 + 0.5 * 2) * (1 + 4 / 5) * (1 + 2 * 0.25) = 10 * 2 * 1.8 * 1.5
    expect(opportunityScore({ recent: 10, listings: 3, avgPain: 4, wtpShare: 0.25 })).toBeCloseTo(54, 10)
    expect(opportunityScore({ recent: 10, listings: 0, avgPain: 0, wtpShare: 0 })).toBe(10)
    expect(opportunityScore({ recent: 0, listings: 5, avgPain: 5, wtpShare: 1 })).toBe(0)
  })
})
