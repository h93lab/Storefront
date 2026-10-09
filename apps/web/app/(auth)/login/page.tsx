import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { hasDevice, passwordConfigured } from "@lens/core"
import { LoginForm } from "@/components/auth-forms"
import { deviceCookie, getSession, safeNext } from "@/lib/auth-server"

export const metadata: Metadata = { title: "Sign in" }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next)
  if (!(await passwordConfigured())) redirect(next === "/" ? "/setup" : `/setup?next=${encodeURIComponent(next)}`)
  if (await getSession()) redirect(next)
  const dev = await deviceCookie()
  const hasPin = dev ? await hasDevice(dev) : false
  return <LoginForm next={next} hasPin={hasPin} />
}
