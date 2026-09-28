import type { Metadata } from "next"
import { getChanges } from "@lens/core"
import { ChangesTimeline } from "@/components/changes-timeline"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"

export const metadata: Metadata = { title: "Changes" }

export default async function ChangesPage() {
  const changes = await getChanges({ limit: 200 })
  return (
    <>
      <PageHeader title="Changes" description="What changed in your tracked apps, detected by each sync." />
      {changes.length ? (
        <Card>
          <CardContent>
            <ChangesTimeline changes={changes} showApp />
          </CardContent>
        </Card>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No changes yet</EmptyTitle>
            <EmptyDescription>
              Each sync compares an app with its previous snapshot. Changes to screenshots, text, price or version show up here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </>
  )
}
