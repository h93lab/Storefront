import { describe, expect, it } from "vitest"
import { parseJsonReply } from "../src/ai"
import { normaliseItem } from "../src/analysis"

describe("AI helpers", () => {
  it("parses JSON wrapped in fences or prose", () => {
    expect(parseJsonReply<{ a: number }>('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(parseJsonReply<{ a: number }>('Sure! {"a":2} hope that helps')).toEqual({ a: 2 })
    expect(() => parseJsonReply("nope")).toThrow(/not valid JSON/)
  })
  it("normalises classifier output to the fixed vocabularies", () => {
    expect(normaliseItem({ id: "1", sentiment: "negative", topic: "pricing", kind: "complaint", label: "Too expensive." })).toEqual({
      id: "1",
      sentiment: "negative",
      topic: "Pricing",
      kind: "complaint",
      label: "Too expensive",
    })
    expect(normaliseItem({ id: "2", sentiment: "angry" as never, topic: "weird", kind: "x" as never })).toMatchObject({
      sentiment: "neutral",
      topic: "Other",
      kind: "other",
      label: "",
    })
    expect(normaliseItem({})).toBeNull()
  })
})
