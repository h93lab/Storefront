import { afterAll, beforeAll, describe, expect, it } from "vitest"

/** Single-user login: password, lockout, epoch and device PINs. Needs TEST_DATABASE_URL (the database is wiped). */
const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip

suite("auth", () => {
  let core: typeof import("../src/index")
  const T0 = new Date("2030-01-01T12:00:00Z")
  const after = (ms: number) => new Date(T0.getTime() + ms)

  beforeAll(async () => {
    process.env.DATABASE_URL = url
    core = await import("../src/index")
    await core.db().unsafe("drop schema public cascade; create schema public;")
    await (await import("../src/migrate")).migrate(() => {})
  })

  afterAll(async () => {
    if (core) await core.closeDb()
  })

  it("hashes with scrypt and compares", async () => {
    const h = await core.hashPassword("correct horse")
    expect(h).toMatch(/^scrypt\$[^$]+\$[^$]+$/)
    expect(await core.verifyPassword("correct horse", h)).toBe(true)
    expect(await core.verifyPassword("wrong", h)).toBe(false)
    expect(await core.verifyPassword("x", "garbage")).toBe(false)
    expect(await core.hashPassword("correct horse")).not.toBe(h)
  })

  it("sets the first password and verifies it", async () => {
    expect(await core.passwordConfigured()).toBe(false)
    expect(await core.authEpoch()).toBeNull()
    await expect(core.setPassword("short")).rejects.toThrow(/at least 8/)
    const { epoch } = await core.setPassword("first-password", {}, T0)
    expect(epoch).toBe(T0.toISOString())
    expect(await core.passwordConfigured()).toBe(true)
    expect(await core.authEpoch()).toBe(epoch)
    expect((await core.checkPassword("first-password", T0)).ok).toBe(true)
    // Setup is one-shot: a second set needs the current password.
    await expect(core.setPassword("another-password")).rejects.toThrow(/current password/)
  })

  it("locks out after 5 failures and escalates up to 15 minutes", async () => {
    for (let i = 1; i <= 4; i++) {
      const r = await core.checkPassword("nope", T0)
      expect(r).toEqual({ ok: false })
    }
    const fifth = await core.checkPassword("nope", T0)
    expect(fifth.ok).toBe(false)
    expect(fifth.lockedUntil).toBe(after(60_000).toISOString())
    // Locked: even the right password is refused, and the counter does not move.
    const locked = await core.checkPassword("first-password", after(30_000))
    expect(locked).toEqual({ ok: false, lockedUntil: after(60_000).toISOString() })
    // Lock expired: another failure doubles it.
    const t1 = after(61_000)
    const sixth = await core.checkPassword("nope", t1)
    expect(sixth.lockedUntil).toBe(new Date(t1.getTime() + 2 * 60_000).toISOString())
    let t = t1
    let last = 2
    for (const expected of [4, 8, 15, 15]) {
      t = new Date(t.getTime() + last * 60_000 + 1000)
      const r = await core.checkPassword("nope", t)
      expect(r.lockedUntil).toBe(new Date(t.getTime() + expected * 60_000).toISOString())
      last = expected
    }
    // The right password after the lock resets everything.
    const ok = await core.checkPassword("first-password", new Date(t.getTime() + 16 * 60_000))
    expect(ok).toEqual({ ok: true })
    expect(await core.checkPassword("nope", t)).toEqual({ ok: false })
  })

  it("changing the password needs the current one and bumps the epoch", async () => {
    const before = await core.authEpoch()
    await expect(core.setPassword("second-password", { current: "wrong-one" }, after(10_000_000))).rejects.toThrow(/incorrect/)
    expect(await core.authEpoch()).toBe(before)
    const { epoch } = await core.setPassword("second-password", { current: "first-password" }, after(20_000_000))
    expect(epoch).not.toBe(before)
    expect(await core.authEpoch()).toBe(epoch)
    expect((await core.checkPassword("first-password", after(20_000_001))).ok).toBe(false)
    expect((await core.checkPassword("second-password", after(30_000_000))).ok).toBe(true)
  })

  it("adds, checks and removes device PINs", async () => {
    await expect(core.addDevice({ name: "Phone", pin: "12345" })).rejects.toThrow(/6 digits/)
    await expect(core.addDevice({ name: "Phone", pin: "12345a" })).rejects.toThrow(/6 digits/)
    const { id } = await core.addDevice({ name: "Phone", pin: "123456" })
    expect(id.length).toBeGreaterThanOrEqual(43)
    const list = await core.listDevices()
    expect(list).toHaveLength(1)
    expect(Object.keys(list[0]!).sort()).toEqual(["createdAt", "id", "lastUsedAt", "name"])
    expect(await core.hasDevice(id)).toBe(true)
    expect(await core.checkPin(id, "123456")).toEqual({ ok: true })
    expect(await core.checkPin(id, "000000")).toEqual({ ok: false })
    expect(await core.checkPin("unknown", "123456")).toEqual({ ok: false })
    await core.touchDevice(id, T0)
    expect((await core.listDevices())[0]!.lastUsedAt).toBe(T0.toISOString())
    await core.removeDevice(id)
    expect(await core.listDevices()).toHaveLength(0)
  })

  it("removes a device after 5 wrong PINs, and a good PIN resets the count", async () => {
    const { id } = await core.addDevice({ name: "Laptop", pin: "654321" })
    for (let i = 0; i < 4; i++) expect(await core.checkPin(id, "111111")).toEqual({ ok: false })
    expect(await core.checkPin(id, "654321")).toEqual({ ok: true })
    for (let i = 0; i < 4; i++) expect(await core.checkPin(id, "111111")).toEqual({ ok: false })
    expect(await core.checkPin(id, "111111")).toEqual({ ok: false, removed: true })
    expect(await core.hasDevice(id)).toBe(false)
    expect(await core.checkPin(id, "654321")).toEqual({ ok: false })
  })
})
