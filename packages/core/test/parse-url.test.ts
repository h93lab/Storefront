import { describe, expect, it } from "vitest"
import { parseStoreUrl } from "../src/stores/parse-url"

describe("parseStoreUrl", () => {
  it("parses App Store links with country", () => {
    expect(parseStoreUrl("https://apps.apple.com/eg/app/calm-sleep-meditation/id571800810")).toEqual({
      store: "ios", storeId: "571800810", country: "eg", lang: null,
    })
    expect(parseStoreUrl("apps.apple.com/us/app/x/id123456789?platform=iphone")?.storeId).toBe("123456789")
  })
  it("parses Google Play links with gl/hl", () => {
    expect(parseStoreUrl("https://play.google.com/store/apps/details?id=com.calm.android&hl=ar&gl=EG")).toEqual({
      store: "android", storeId: "com.calm.android", country: "eg", lang: "ar",
    })
    expect(parseStoreUrl("https://play.google.com/store/apps/details?id=com.x.y&hl=en_US")?.lang).toBe("en")
  })
  it("parses bare ids", () => {
    expect(parseStoreUrl("id571800810")?.store).toBe("ios")
    expect(parseStoreUrl("571800810")?.storeId).toBe("571800810")
    expect(parseStoreUrl("com.getsomeheadspace.android")?.store).toBe("android")
  })
  it("rejects other input", () => {
    expect(parseStoreUrl("")).toBeNull()
    expect(parseStoreUrl("https://example.com/app")).toBeNull()
    expect(parseStoreUrl("https://play.google.com/store/apps")).toBeNull()
    expect(parseStoreUrl("calm")).toBeNull()
  })
})
