import crypto from "node:crypto"
import { promisify } from "node:util"
import { db } from "./db"
import { DEFAULT_SETTINGS, type Settings } from "./settings"

/**
 * Single-user login. Password and PIN hashes live in the `auth` settings key, which must never reach a
 * client component. Session cookies are signed in apps/web/lib/session.ts (Web Crypto, usable from proxy.ts).
 */
type Auth = Settings["auth"]

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, keylen: number, opts: crypto.ScryptOptions) => Promise<Buffer>
const SCRYPT = { N: 16384, r: 8, p: 1 }
const KEY_LEN = 64

export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_ATTEMPTS = 5
export const MAX_PIN_ATTEMPTS = 5
export const MAX_LOCK_MINUTES = 15

async function hashSecret(secret: string) {
  const salt = crypto.randomBytes(16)
  const hash = await scrypt(secret, salt, KEY_LEN, SCRYPT)
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`
}

async function verifySecret(secret: string, stored: string) {
  const [scheme, saltB64, hashB64] = stored.split("$")
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false
  const expected = Buffer.from(hashB64, "base64")
  if (expected.length !== KEY_LEN) return false
  const actual = await scrypt(secret, Buffer.from(saltB64, "base64"), KEY_LEN, SCRYPT)
  return crypto.timingSafeEqual(actual, expected)
}

export const hashPassword = (pw: string) => hashSecret(pw)
export const verifyPassword = (pw: string, hash: string) => verifySecret(pw, hash)
export const hashPin = (pin: string) => hashSecret(pin)
export const verifyPin = (pin: string, hash: string) => verifySecret(pin, hash)

export const isValidPin = (pin: string) => /^\d{6}$/.test(pin)

function normalise(value: unknown): Auth {
  const v = (value && typeof value === "object" ? value : {}) as Partial<Auth>
  return {
    ...DEFAULT_SETTINGS.auth,
    ...v,
    devices: Array.isArray(v.devices) ? v.devices : [],
    failed: { ...DEFAULT_SETTINGS.auth.failed, ...(v.failed ?? {}) },
  }
}

async function readAuth(): Promise<Auth> {
  const rows = await db()<{ value: unknown }[]>`select value from settings where key = 'auth'`
  return normalise(rows[0]?.value)
}

/** Read-modify-write of the auth key under an advisory lock, so concurrent attempts cannot dodge the counters. */
async function updateAuth<T>(fn: (auth: Auth) => Promise<{ auth: Auth; result: T }> | { auth: Auth; result: T }): Promise<T> {
  return db().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('lens_auth'))`
    const rows = await tx<{ value: unknown }[]>`select value from settings where key = 'auth'`
    const { auth, result } = await fn(normalise(rows[0]?.value))
    await tx`insert into settings (key, value) values ('auth', ${tx.json(auth as never)})
      on conflict (key) do update set value = excluded.value`
    return result
  }) as Promise<T>
}

export async function passwordConfigured() {
  return Boolean((await readAuth()).passwordHash)
}

/** The current password epoch: sessions signed under an older one are invalid. */
export async function authEpoch() {
  return (await readAuth()).passwordSetAt
}

/** Lock length after the Nth consecutive failure: 1 min at 5 failures, then doubling, capped at 15 min. */
export function lockMinutes(failures: number) {
  if (failures < MAX_PASSWORD_ATTEMPTS) return 0
  return Math.min(MAX_LOCK_MINUTES, 2 ** (failures - MAX_PASSWORD_ATTEMPTS))
}

type Check = { ok: boolean; lockedUntil?: string }

async function checkIn(auth: Auth, pw: string, now: Date): Promise<{ auth: Auth; result: Check }> {
  const until = auth.failed.until ? new Date(auth.failed.until) : null
  if (until && until > now) return { auth, result: { ok: false, lockedUntil: until.toISOString() } }
  if (auth.passwordHash && (await verifyPassword(pw, auth.passwordHash))) {
    return { auth: { ...auth, failed: { count: 0, until: null } }, result: { ok: true } }
  }
  const count = auth.failed.count + 1
  const minutes = lockMinutes(count)
  const lock = minutes ? new Date(now.getTime() + minutes * 60_000).toISOString() : null
  return { auth: { ...auth, failed: { count, until: lock } }, result: { ok: false, ...(lock ? { lockedUntil: lock } : {}) } }
}

/** Verifies the password and applies the lockout. While locked the password is not even checked. */
export function checkPassword(pw: string, now = new Date()): Promise<Check> {
  return updateAuth((auth) => checkIn(auth, pw, now))
}

/**
 * Sets the first password, or changes it (the current one is then required and counts toward the lockout).
 * Bumps the epoch, which signs every other session out, and returns the new epoch.
 */
export async function setPassword(newPw: string, opts: { current?: string } = {}, now = new Date()): Promise<{ epoch: string }> {
  if (newPw.length < MIN_PASSWORD_LENGTH) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  const hash = await hashPassword(newPw)
  const out = await updateAuth<{ epoch: string } | { error: string }>(async (auth) => {
    let base = auth
    if (auth.passwordHash) {
      if (opts.current === undefined) return { auth, result: { error: "Enter your current password." } }
      const checked = await checkIn(auth, opts.current, now)
      // A refused change still persists the failure count.
      if (!checked.result.ok) {
        const error = checked.result.lockedUntil ? "Too many attempts. Try again later." : "Current password is incorrect."
        return { auth: checked.auth, result: { error } }
      }
      base = checked.auth
    }
    const epoch = now.toISOString()
    return { auth: { ...base, passwordHash: hash, passwordSetAt: epoch, failed: { count: 0, until: null } }, result: { epoch } }
  })
  if ("error" in out) throw new Error(out.error)
  return out
}

export type DeviceInfo = { id: string; name: string; createdAt: string; lastUsedAt: string | null }

export async function listDevices(): Promise<DeviceInfo[]> {
  return (await readAuth()).devices.map(({ id, name, createdAt, lastUsedAt }) => ({ id, name, createdAt, lastUsedAt }))
}

export async function hasDevice(id: string) {
  return (await readAuth()).devices.some((d) => d.id === id)
}

export async function addDevice({ name, pin }: { name: string; pin: string }, now = new Date()): Promise<{ id: string }> {
  if (!isValidPin(pin)) throw new Error("The PIN must be exactly 6 digits.")
  const pinHash = await hashPin(pin)
  const id = crypto.randomBytes(32).toString("base64url")
  const label = name.trim().slice(0, 60) || "This device"
  await updateAuth((auth) => ({
    auth: {
      ...auth,
      devices: [...auth.devices, { id, name: label, pinHash, createdAt: now.toISOString(), lastUsedAt: null, failed: 0 }],
    },
    result: null,
  }))
  return { id }
}

export async function removeDevice(id: string) {
  await updateAuth((auth) => ({ auth: { ...auth, devices: auth.devices.filter((d) => d.id !== id) }, result: null }))
}

/** Checks a device PIN. The fifth wrong PIN removes the device, so the password is needed again. */
export function checkPin(deviceId: string, pin: string): Promise<{ ok: boolean; removed?: boolean }> {
  return updateAuth<{ ok: boolean; removed?: boolean }>(async (auth) => {
    const device = auth.devices.find((d) => d.id === deviceId)
    if (!device) return { auth, result: { ok: false } }
    if (isValidPin(pin) && (await verifyPin(pin, device.pinHash))) {
      const devices = auth.devices.map((d) => (d.id === deviceId ? { ...d, failed: 0 } : d))
      return { auth: { ...auth, devices }, result: { ok: true } }
    }
    const failed = device.failed + 1
    if (failed >= MAX_PIN_ATTEMPTS) {
      return { auth: { ...auth, devices: auth.devices.filter((d) => d.id !== deviceId) }, result: { ok: false, removed: true } }
    }
    return { auth: { ...auth, devices: auth.devices.map((d) => (d.id === deviceId ? { ...d, failed } : d)) }, result: { ok: false } }
  })
}

export async function touchDevice(id: string, now = new Date()) {
  await updateAuth((auth) => ({
    auth: { ...auth, devices: auth.devices.map((d) => (d.id === id ? { ...d, lastUsedAt: now.toISOString() } : d)) },
    result: null,
  }))
}
