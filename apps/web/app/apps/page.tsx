import type { Metadata } from "next"
import { activeJobs, categories as listCategories, listApps } from "@lens/core"
import { AddAppDialog } from "@/components/add-app-dialog"
import { AppCard } from "@/components/app-card"
import { JobWatcher } from "@/components/job-watcher"
import { LibraryFilters } from "@/components/library-filters"
import { PageHeader } from "@/components/page-header"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"

export const metadata: Metadata = { title: "Library" }

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const store = sp.store === "ios" || sp.store === "android" ? sp.store : "all"
  const filteredQuery = Boolean(sp.q || sp.category || store !== "all")
  const [apps, all, categories, active] = await Promise.all([
    listApps({ q: sp.q, store, category: sp.category }),
    filteredQuery ? listApps() : null,
    listCategories(),
    activeJobs(),
  ])
  const total = (all ?? apps).length
  const filtered = Boolean(sp.q || sp.category || store !== "all")

  return (
    <>
      <JobWatcher variant="none" initial={active.map((j) => ({ ...j, run_after: new Date(j.run_after).toISOString() }))} />
      <PageHeader
        title="Library"
        description={`${total} app${total === 1 ? "" : "s"} tracked across both stores. Synced on your schedule with their latest reviews.`}
      />
      <LibraryFilters categories={categories} controls={total > 0}>
        {apps.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {apps.map((a) => (
              <AppCard key={a.id} app={a} />
            ))}
          </div>
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>{filtered ? "No apps match these filters" : "No apps yet"}</EmptyTitle>
              <EmptyDescription>
                {filtered ? "Try another name or clear the filters." : "Paste an App Store or Google Play link to add your first app."}
              </EmptyDescription>
            </EmptyHeader>
            {!filtered && (
              <EmptyContent>
                <AddAppDialog />
              </EmptyContent>
            )}
          </Empty>
        )}
      </LibraryFilters>
    </>
  )
}
