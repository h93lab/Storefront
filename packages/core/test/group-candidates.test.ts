import { describe, expect, it } from "vitest"
import { candidateOpportunities } from "../src/opportunities"

const opp = (id: number, label: string) => ({ id, label })

describe("candidateOpportunities", () => {
  const existing = [opp(1, "dark mode — settings"), opp(2, "offline sync — notes"), opp(3, "export pdf — reports")]

  it("keeps only opportunities that share words with the batch", () => {
    expect(candidateOpportunities(existing, [{ label: "no dark mode option" }]).map((o) => o.id)).toEqual([1])
  })

  it("returns nothing when no word is shared", () => {
    expect(candidateOpportunities(existing, [{ label: "voice assistant" }])).toEqual([])
  })

  it("ranks a rare shared word above a common one and honours the cap", () => {
    const many = [opp(1, "calendar sync"), ...Array.from({ length: 20 }, (_, i) => opp(i + 2, `sync thing ${i}`))]
    const out = candidateOpportunities(many, [{ label: "calendar sync broken" }], 3)
    expect(out).toHaveLength(3)
    expect(out[0].id).toBe(1)
  })
})
