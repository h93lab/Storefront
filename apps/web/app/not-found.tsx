import Link from "next/link"

export default function RootNotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-2 p-4 text-center">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <Link href="/" className="text-sm text-muted-foreground underline underline-offset-4">
        Back to Storefront Lens
      </Link>
    </main>
  )
}
