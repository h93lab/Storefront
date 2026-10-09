/**
 * Signed session cookies. Web Crypto only (no node:crypto, no @lens/core) because proxy.ts imports this.
 * Format: base64url(json) + "." + base64url(HMAC-SHA256(secret, json)).
 */
export const SESSION_COOKIE = "lens_session"
export const DEVICE_COOKIE = "lens_device"
export const SESSION_DAYS_REMEMBER = 30
export const SESSION_HOURS_DEFAULT = 12
export const DEVICE_DAYS = 180

export interface SessionPayload {
  /** Issued at / expires at, seconds since the epoch. */
  iat: number
  exp: number
  /** `passwordSetAt` when the session was issued; a password change invalidates older sessions. */
  epoch: string | null
  /** Device id when the session came from a PIN unlock. */
  dev?: string
}

const enc = new TextEncoder()

function b64url(bytes: Uint8Array) {
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function unb64url(value: string) {
  const s = atob(value.replace(/-/g, "+").replace(/_/g, "/"))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}

const hmacKey = (secret: string, usage: "sign" | "verify") =>
  crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage])

/** The signing secret; throws a clear error when it is missing or too short. */
export function sessionSecret() {
  const secret = process.env.SESSION_SECRET ?? ""
  if (secret.length < 32) {
    throw new Error("SESSION_SECRET is missing or shorter than 32 characters. Set it in .env (generate one with: openssl rand -hex 32).")
  }
  return secret
}

export async function signSession(payload: SessionPayload, secret: string) {
  const json = enc.encode(JSON.stringify(payload))
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), json)
  return `${b64url(json)}.${b64url(new Uint8Array(sig))}`
}

/** Returns the payload when the signature is valid and the session has not expired, else null. */
export async function verifySession(value: string | undefined | null, secret: string): Promise<SessionPayload | null> {
  if (!value) return null
  const [body, sig, extra] = value.split(".")
  if (!body || !sig || extra !== undefined) return null
  try {
    const json = unb64url(body)
    // crypto.subtle.verify compares in constant time.
    if (!(await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), unb64url(sig), json))) return null
    const p = JSON.parse(new TextDecoder().decode(json)) as SessionPayload
    if (typeof p.exp !== "number" || p.exp * 1000 <= Date.now()) return null
    return p
  } catch {
    return null
  }
}

/** Cookie attributes shared by both cookies. `Secure` follows PUBLIC_URL so plain-http local use keeps working. */
export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: (process.env.PUBLIC_URL ?? "").startsWith("https://"),
    path: "/",
    maxAge: maxAgeSeconds,
  }
}
