import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { authEpoch } from "@lens/core"
import {
  cookieOptions,
  DEVICE_COOKIE,
  DEVICE_DAYS,
  SESSION_COOKIE,
  SESSION_DAYS_REMEMBER,
  SESSION_HOURS_DEFAULT,
  sessionSecret,
  signSession,
  verifySession,
  type SessionPayload,
} from "@/lib/session"

/** A same-origin path to return to after login; anything else falls back to "/". */
export function safeNext(next: string | null | undefined) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /[\u0000-\u001f]/.test(next)) return "/"
  return /^\/(login|setup)(\/|\?|$)/.test(next) ? "/" : next
}

/** The signed-in session, or null. Checks signature, expiry and the password epoch. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies()
  const payload = await verifySession(store.get(SESSION_COOKIE)?.value, sessionSecret())
  if (!payload) return null
  return payload.epoch === (await authEpoch()) ? payload : null
}

/** For layouts and server actions: sends the visitor to /login unless the session is valid. */
export async function requireSession() {
  const session = await getSession()
  if (!session) redirect("/login")
  return session
}

export async function startSession({ remember, dev, epoch }: { remember: boolean; dev?: string; epoch?: string | null }) {
  const seconds = remember ? SESSION_DAYS_REMEMBER * 86400 : SESSION_HOURS_DEFAULT * 3600
  const iat = Math.floor(Date.now() / 1000)
  const value = await signSession(
    { iat, exp: iat + seconds, epoch: epoch === undefined ? await authEpoch() : epoch, ...(dev ? { dev } : {}) },
    sessionSecret(),
  )
  ;(await cookies()).set(SESSION_COOKIE, value, cookieOptions(seconds))
}

export async function endSession() {
  ;(await cookies()).delete(SESSION_COOKIE)
}

export async function deviceCookie() {
  return (await cookies()).get(DEVICE_COOKIE)?.value ?? null
}

export async function setDeviceCookie(id: string) {
  ;(await cookies()).set(DEVICE_COOKIE, id, cookieOptions(DEVICE_DAYS * 86400))
}

export async function clearDeviceCookie() {
  ;(await cookies()).delete(DEVICE_COOKIE)
}
