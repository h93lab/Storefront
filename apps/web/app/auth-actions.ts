"use server"

import { redirect } from "next/navigation"
import { addDevice, checkPassword, checkPin, hasDevice, passwordConfigured, removeDevice, setPassword, touchDevice } from "@lens/core"
import { clearDeviceCookie, deviceCookie, endSession, requireSession, safeNext, setDeviceCookie, startSession } from "@/lib/auth-server"

export type AuthResult = { ok: true; next: string } | { ok: false; error: string; lockedUntil?: string; removed?: boolean }
type Plain = { ok: true } | { ok: false; error: string }

const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : String(e) })

/** First-run password. Refused once a password exists. */
export async function setupAction(input: { password: string; confirm: string; next?: string }): Promise<AuthResult> {
  try {
    if (await passwordConfigured()) return { ok: false, error: "A password is already set. Sign in instead." }
    if (input.password !== input.confirm) return { ok: false, error: "The passwords do not match." }
    const { epoch } = await setPassword(input.password)
    await startSession({ remember: false, epoch })
    return { ok: true, next: safeNext(input.next) }
  } catch (e) {
    return fail(e)
  }
}

export async function loginAction(input: { password: string; remember: boolean; next?: string }): Promise<AuthResult> {
  try {
    const r = await checkPassword(input.password)
    if (!r.ok) {
      return r.lockedUntil
        ? { ok: false, error: "Too many wrong passwords.", lockedUntil: r.lockedUntil }
        : { ok: false, error: "Wrong password." }
    }
    await startSession({ remember: input.remember })
    return { ok: true, next: safeNext(input.next) }
  } catch (e) {
    return fail(e)
  }
}

/** PIN unlock for a device that enabled one. A PIN session lasts as long as "Remember me". */
export async function pinLoginAction(input: { pin: string; next?: string }): Promise<AuthResult> {
  try {
    const dev = await deviceCookie()
    if (!dev) return { ok: false, error: "This device has no PIN. Use your password.", removed: true }
    const r = await checkPin(dev, input.pin)
    if (r.ok) {
      await touchDevice(dev)
      await startSession({ remember: true, dev })
      return { ok: true, next: safeNext(input.next) }
    }
    if (r.removed || !(await hasDevice(dev))) {
      await clearDeviceCookie()
      return { ok: false, error: "Too many wrong PINs. The PIN for this device was removed; use your password.", removed: true }
    }
    return { ok: false, error: "Wrong PIN." }
  } catch (e) {
    return fail(e)
  }
}

export async function logoutAction() {
  await endSession()
  redirect("/login")
}

export async function changePasswordAction(input: { current: string; next: string; confirm: string }): Promise<Plain> {
  const session = await requireSession()
  try {
    if (input.next !== input.confirm) return { ok: false, error: "The new passwords do not match." }
    const { epoch } = await setPassword(input.next, { current: input.current })
    // Every other session is now invalid; keep this one alive under the new epoch.
    await startSession({ remember: session.exp - session.iat > 86400, dev: session.dev, epoch })
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function enablePinAction(input: { name: string; pin: string; confirm: string }): Promise<Plain> {
  await requireSession()
  try {
    if (input.pin !== input.confirm) return { ok: false, error: "The PINs do not match." }
    const previous = await deviceCookie()
    const { id } = await addDevice({ name: input.name, pin: input.pin })
    if (previous) await removeDevice(previous)
    await setDeviceCookie(id)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function removeDeviceAction(id: string): Promise<Plain> {
  await requireSession()
  try {
    await removeDevice(id)
    if ((await deviceCookie()) === id) await clearDeviceCookie()
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
