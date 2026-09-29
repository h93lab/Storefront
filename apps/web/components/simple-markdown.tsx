import * as React from "react"

function inline(text: string): React.ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
      return (
        <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      )
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>
    return part
  })
}

/** Read-only renderer for the subset of Markdown the spec uses: headings, lists, paragraphs and code fences. */
export function SimpleMarkdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n")
  const out: React.ReactNode[] = []
  let i = 0
  let key = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim().startsWith("```")) {
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i++])
      i++
      out.push(
        <pre key={key++} className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">
          <code>{code.join("\n")}</code>
        </pre>,
      )
      continue
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      const level = h[1].length
      out.push(
        level === 1 ? (
          <h2 key={key++} className="mt-2 text-xl font-semibold tracking-tight">
            {inline(h[2])}
          </h2>
        ) : level === 2 ? (
          <h3 key={key++} className="mt-2 text-lg font-semibold">
            {inline(h[2])}
          </h3>
        ) : (
          <h4 key={key++} className="mt-1 font-medium">
            {inline(h[2])}
          </h4>
        ),
      )
      i++
      continue
    }
    const li = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(line)
    if (li) {
      const ordered = /\d+\./.test(li[1])
      const items: string[] = []
      while (i < lines.length) {
        const m = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(lines[i])
        if (!m) break
        items.push(m[2])
        i++
      }
      const Tag = ordered ? "ol" : "ul"
      out.push(
        <Tag key={key++} className={ordered ? "ml-5 list-decimal space-y-1 text-sm" : "ml-5 list-disc space-y-1 text-sm"}>
          {items.map((t, n) => (
            <li key={n}>{inline(t)}</li>
          ))}
        </Tag>,
      )
      continue
    }
    if (!line.trim()) {
      i++
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*([-*]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++])
    out.push(
      <p key={key++} className="max-w-prose text-sm leading-relaxed">
        {inline(para.join(" "))}
      </p>,
    )
  }
  return <div className="grid gap-3">{out}</div>
}
