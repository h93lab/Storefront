import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  tone?: "good" | "bad"
}) {
  return (
    <Card className="gap-2 py-5">
      <CardHeader className="gap-2 px-5">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">{value}</CardTitle>
        {hint ? (
          <p className={cn("text-xs text-muted-foreground", tone === "good" && "text-success", tone === "bad" && "text-destructive")}>
            {hint}
          </p>
        ) : null}
      </CardHeader>
    </Card>
  )
}
