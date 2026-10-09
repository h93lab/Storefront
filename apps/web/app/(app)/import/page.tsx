import type { Metadata } from "next"
import { navSummary } from "@lens/core"
import { ImportForm } from "@/components/import-form"
import { PageHeader } from "@/components/page-header"

export const metadata: Metadata = { title: "Import" }

export default async function ImportPage() {
  const nav = await navSummary()
  return (
    <>
      <PageHeader
        title="Import"
        description="Add text from outside the stores, such as Reddit threads or support tickets. Duplicates are skipped. Analysis runs in the worker, and the results appear as evidence on Opportunities."
      />
      <ImportForm apps={nav.apps.map((a) => ({ id: a.id, name: a.name, icon: a.icon }))} />
    </>
  )
}
