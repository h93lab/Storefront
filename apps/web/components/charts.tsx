"use client"

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"

const shortDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })

export function ReviewsPerDayChart({ data }: { data: { day: string; count: number }[] }) {
  const config = { count: { label: "Reviews", color: "var(--chart-1)" } } satisfies ChartConfig
  return (
    <ChartContainer config={config} className="aspect-auto h-56 w-full">
      <AreaChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="fillCount" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-count)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--color-count)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={40} tickFormatter={shortDay} />
        <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" labelFormatter={(v) => shortDay(String(v))} />} />
        <Area dataKey="count" type="monotone" fill="url(#fillCount)" stroke="var(--color-count)" strokeWidth={2} />
      </AreaChart>
    </ChartContainer>
  )
}

export function RatingChart({ data }: { data: { day: string; rating: number | null }[] }) {
  const config = { rating: { label: "Rating", color: "var(--chart-2)" } } satisfies ChartConfig
  const values = data.map((d) => d.rating).filter((v): v is number => v != null)
  const min = Math.max(0, Math.floor((Math.min(...values) - 0.05) * 20) / 20)
  const max = Math.min(5, Math.ceil((Math.max(...values) + 0.05) * 20) / 20)
  return (
    <ChartContainer config={config} className="aspect-auto h-52 w-full">
      <AreaChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="fillRating" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-rating)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--color-rating)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={48} tickFormatter={shortDay} />
        <YAxis domain={[min, max]} tickLine={false} axisLine={false} width={36} tickFormatter={(v: number) => v.toFixed(2)} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              indicator="line"
              labelFormatter={(v) => shortDay(String(v))}
              formatter={(v) => <span className="font-mono tabular-nums">★ {Number(v).toFixed(2)}</span>}
            />
          }
        />
        <Area dataKey="rating" type="monotone" fill="url(#fillRating)" stroke="var(--color-rating)" strokeWidth={2} connectNulls />
      </AreaChart>
    </ChartContainer>
  )
}
