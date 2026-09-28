"use client"

import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const db = /DATABASE_URL|ECONNREFUSED|password authentication|getaddrinfo/i.test(error.message)
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyTitle>{db ? "Can't reach the database" : "Something went wrong"}</EmptyTitle>
        <EmptyDescription>
          {db
            ? "Check DATABASE_URL in your .env file and that Supabase is reachable, then retry."
            : error.message || "An unexpected error occurred."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={reset}>Try again</Button>
      </EmptyContent>
    </Empty>
  )
}
