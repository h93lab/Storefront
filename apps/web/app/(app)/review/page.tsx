import type { Metadata } from "next"
import { accuracyStats, reviewQueue } from "@lens/core"
import { PageHeader } from "@/components/page-header"
import { ReviewQueue } from "@/components/review-queue"
import { StatCard } from "@/components/stat-card"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { SIGNAL_LABEL } from "@/lib/opportunities"

export const metadata: Metadata = { title: "Label review" }

const pct = (correct: number, total: number) => (total ? `${Math.round((correct / total) * 100)}%` : "—")

export default async function ReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const onlySignals = sp.signals === "1"
  const [queue, stats] = await Promise.all([reviewQueue({ limit: 20, onlySignals }), accuracyStats()])
  const latest = stats.byVersion.at(-1)

  return (
    <>
      <PageHeader
        title="Label review"
        description="Check the model's labels against the original text. Your verdicts measure how far to trust the scores."
      />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="Overall accuracy"
          value={stats.total ? pct(stats.correct, stats.total) : "—"}
          hint={stats.total ? `${stats.correct} correct, ${stats.wrong} wrong` : "No verdicts yet"}
          tone={stats.total && stats.accuracy >= 0.8 ? "good" : stats.total && stats.accuracy < 0.6 ? "bad" : undefined}
        />
        <StatCard label="Verdicts" value={stats.total.toLocaleString()} hint="Judged by you" />
        <StatCard
          label="Current analyser"
          value={latest ? pct(latest.correct, latest.total) : "—"}
          hint={latest ? `Version ${latest.version} · ${latest.total} verdicts` : "Nothing judged yet"}
        />
        <StatCard
          label="In this queue"
          value={queue.length}
          hint={onlySignals ? "Only items with signals" : "Signals first, then random"}
        />
      </div>

      {stats.bySignal.length > 0 && (
        <Card className="pb-2">
          <CardHeader>
            <CardTitle>Accuracy by signal</CardTitle>
            <CardDescription>Bucketed by what the model originally said, so a correction does not change the bucket.</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Signal</TableHead>
                  <TableHead className="text-right">Verdicts</TableHead>
                  <TableHead className="text-right">Correct</TableHead>
                  <TableHead className="pr-6 text-right">Accuracy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.bySignal.map((s) => (
                  <TableRow key={s.signal}>
                    <TableCell className="pl-6 font-medium">
                      {SIGNAL_LABEL[s.signal] ?? (s.signal === "none" ? "No signal" : s.signal)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.total}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.correct}</TableCell>
                    <TableCell className="pr-6 text-right tabular-nums">{pct(s.correct, s.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <ReviewQueue
        key={`${onlySignals}:${queue.map((q) => q.ref).join(",")}`}
        onlySignals={onlySignals}
        rows={queue.map((e) => ({ ...e, date: e.date ? new Date(e.date).toISOString() : null }))}
      />
    </>
  )
}
