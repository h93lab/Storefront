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
    <Card className="gap-2 py-4 sm:py-5">
      <CardHeader className="gap-1.5 px-4 sm:gap-2 sm:px-5">
        <CardDescription className="truncate">{label}</CardDescription>
        <CardTitle className="truncate text-xl font-semibold tabular-nums sm:text-2xl">{value}</CardTitle>
        {hint ? (
          <p className={cn("text-xs text-muted-foreground", tone === "good" && "text-success", tone === "bad" && "text-destructive")}>
            {hint}
          </p>
        ) : null}
      </CardHeader>
    </Card>
  )
}
