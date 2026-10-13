import { describe, expect, it, vi } from "vitest"
import { watchPool } from "../src/db"

/** The pool watchdog needs no database: a fake client stands in for postgres.js. */
const fake = (probe: () => PromiseLike<unknown>) => Object.assign(() => probe(), { end: vi.fn(async () => {}) })
const fast = { everyMs: 10, timeoutMs: 10, fails: 2 }
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("watchPool", () => {
  it("destroys a pool whose probe never answers", async () => {
    const c = fake(() => new Promise(() => {}))
    const reset = vi.fn()
    const stop = watchPool(c as never, reset, fast)
    await wait(200)
    stop()
    expect(reset).toHaveBeenCalledTimes(1)
    expect(c.end).toHaveBeenCalledWith({ timeout: 0 })
  })

  it("leaves a healthy pool alone", async () => {
    const c = fake(async () => [{ "?column?": 1 }])
    const reset = vi.fn()
    const stop = watchPool(c as never, reset, fast)
    await wait(200)
    stop()
    expect(reset).not.toHaveBeenCalled()
    expect(c.end).not.toHaveBeenCalled()
  })

  it("forgives one slow probe", async () => {
    let n = 0
    const c = fake(() => (++n === 1 ? new Promise(() => {}) : Promise.resolve([])))
    const reset = vi.fn()
    const stop = watchPool(c as never, reset, fast)
    await wait(200)
    stop()
    expect(reset).not.toHaveBeenCalled()
  })
})
