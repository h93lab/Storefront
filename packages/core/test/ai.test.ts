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
    expect(normaliseItem({ id: "1", sentiment: "negative", topic: "pricing", kind: "complaint", label: "Too expensive." })).toMatchObject({
      id: "1",
      sentiment: "negative",
      topic: "Pricing",
      kind: "complaint",
      label: "Too expensive",
      wtp_signal: "none",
      competitor: null,
      workaround: null,
      evidence: null,
      pain: 0,
    })
    expect(
      normaliseItem({ id: "2", sentiment: "angry" as never, topic: "weird", kind: "x" as never, wtp_signal: "maybe" as never }),
    ).toMatchObject({ sentiment: "neutral", topic: "Other", kind: "other", label: "", wtp_signal: "none" })
    expect(normaliseItem({})).toBeNull()
  })
  it("keeps opportunity signals only when they are well-formed", () => {
    const source = "Title\nI cancelled and went back to Headspace, it has offline mode"
    const item = normaliseItem(
      {
        id: "3",
        wtp_signal: "churned",
        competitor: "Headspace",
        workaround: "  downloads files by hand  ",
        evidence: "went back to Headspace",
        pain: 7,
      },
      source,
    )
    expect(item).toMatchObject({
      wtp_signal: "churned",
      competitor: "Headspace",
      workaround: "downloads files by hand",
      evidence: "went back to Headspace",
      pain: 5,
    })
    expect(item!.raw).toMatchObject({ id: "3", pain: 7 })
    // a paraphrased quote is dropped, the rest of the item is kept
    expect(normaliseItem({ id: "4", evidence: "switched to Headspace", pain: "2" as never }, source)).toMatchObject({
      evidence: null,
      pain: 2,
    })
    // without the source text the quote cannot be checked and is kept as is
    expect(normaliseItem({ id: "5", evidence: "anything" })!.evidence).toBe("anything")
    expect(normaliseItem({ id: "6", competitor: 42 as never, workaround: "" })).toMatchObject({ competitor: null, workaround: null })
    expect(normaliseItem({ id: "7", label: "x".repeat(100) })!.label).toHaveLength(80)
  })
})

describe("AI provider errors", () => {
  it("explains unreachable hosts and bad URLs", async () => {
    const { chat } = await import("../src/ai")
    const cfg = { baseUrl: "http://127.0.0.1:59999/v1", model: "m", apiKey: "", autoAnalyse: true }
    await expect(chat(cfg, [{ role: "user", content: "hi" }])).rejects.toThrow(
      /Could not reach the AI provider at 127\.0\.0\.1:59999 \(ECONNREFUSED\)/,
    )
    await expect(chat({ ...cfg, baseUrl: "not a url" }, [{ role: "user", content: "hi" }])).rejects.toThrow(/not a valid URL/)
  })
})
