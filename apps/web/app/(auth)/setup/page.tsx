import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { passwordConfigured } from "@lens/core"
import { SetupForm } from "@/components/auth-forms"
import { safeNext } from "@/lib/auth-server"

export const metadata: Metadata = { title: "Set up" }

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  if (await passwordConfigured()) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login")
  return <SetupForm next={safeNext(next)} />
}
