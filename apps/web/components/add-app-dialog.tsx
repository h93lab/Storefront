"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Check, Link2, Plus, Search } from "lucide-react"
import { toast } from "sonner"
import { addAppAction } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { COUNTRIES, LANGUAGES } from "@/lib/format"
import { cn } from "@/lib/utils"

interface Result {
  store: "ios" | "android"
  storeId: string
  name: string
  developer: string | null
  iconUrl: string | null
  rating: number | null
}

export function AddAppDialog() {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [mode, setMode] = React.useState<"link" | "search">("link")
  const [link, setLink] = React.useState("")
  const [store, setStore] = React.useState<"ios" | "android">("ios")
  const [term, setTerm] = React.useState("")
  const [results, setResults] = React.useState<Result[]>([])
  const [searching, setSearching] = React.useState(false)
  const [searchError, setSearchError] = React.useState<string | null>(null)
  const [picked, setPicked] = React.useState<Result | null>(null)
  const [country, setCountry] = React.useState("")
  const [lang, setLang] = React.useState("auto")
  const [pending, startTransition] = React.useTransition()

  const reset = () => {
    setLink("")
    setTerm("")
    setResults([])
    setPicked(null)
    setSearchError(null)
  }

  async function search(e?: React.FormEvent) {
    e?.preventDefault()
    if (!term.trim()) return
    setSearching(true)
    setSearchError(null)
    setPicked(null)
    try {
      const res = await fetch(`/api/store-search?store=${store}&term=${encodeURIComponent(term)}&country=${country || "us"}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? "Search failed")
      setResults(body.results)
      if (!body.results.length) setSearchError("No apps found. Try another name or paste the store link.")
    } catch (err) {
      setResults([])
      setSearchError((err as Error).message)
    } finally {
      setSearching(false)
    }
  }

  function submit() {
    const value = mode === "link" ? link : (picked?.storeId ?? "")
    if (!value) return
    startTransition(async () => {
      const r = await addAppAction({ link: value, country: country || undefined, lang: lang === "auto" ? undefined : lang })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(
        r.data?.created ? "App added. Fetching listing, screenshots and reviews…" : "Already in your library. A fresh sync was queued.",
      )
      setOpen(false)
      reset()
      router.push(`/apps/${r.data!.id}`)
    })
  }

  const canSubmit = mode === "link" ? link.trim().length > 3 : Boolean(picked)

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="h-8" aria-label="Add app">
          <Plus />
          <span className="hidden sm:inline">Add app</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add app</DialogTitle>
          <DialogDescription>Pull the listing, screenshots and latest reviews into your library.</DialogDescription>
        </DialogHeader>
        <Tabs value={mode} onValueChange={(v) => setMode(v as "link" | "search")}>
          <TabsList className="w-full">
            <TabsTrigger value="link">
              <Link2 />
              Paste link
            </TabsTrigger>
            <TabsTrigger value="search">
              <Search />
              Search
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {mode === "link" ? (
          <div className="grid gap-2">
            <Label htmlFor="store-link">Store link</Label>
            <Input
              id="store-link"
              autoFocus
              placeholder="https://apps.apple.com/… or https://play.google.com/…"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canSubmit && submit()}
            />
            <p className="text-xs text-muted-foreground">
              Also accepts an iOS id (id571800810) or an Android package name (com.calm.android).
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            <form onSubmit={search} className="flex gap-2">
              <Select value={store} onValueChange={(v) => setStore(v as "ios" | "android")}>
                <SelectTrigger className="w-36 shrink-0" aria-label="Store">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ios">App Store</SelectItem>
                  <SelectItem value="android">Google Play</SelectItem>
                </SelectContent>
              </Select>
              <Input autoFocus placeholder="App name" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="App name" />
              <Button type="submit" variant="secondary" disabled={searching || !term.trim()}>
                {searching ? <Spinner /> : <Search />}
                <span className="sr-only">Search</span>
              </Button>
            </form>
            {searchError && <p className="text-sm text-muted-foreground">{searchError}</p>}
            {results.length > 0 && (
              <div className="grid max-h-64 gap-2 overflow-y-auto pr-1">
                {results.map((r) => (
                  <button
                    key={r.storeId}
                    type="button"
                    onClick={() => setPicked(r)}
                    aria-pressed={picked?.storeId === r.storeId}
                    className={cn(
                      "flex items-center gap-3 rounded-md border p-2 text-left text-sm transition-colors hover:bg-accent",
                      picked?.storeId === r.storeId && "border-ring bg-accent",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {r.iconUrl ? (
                      <img src={r.iconUrl} alt="" className="size-9 rounded-lg border" />
                    ) : (
                      <div className="size-9 rounded-lg bg-muted" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{r.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {r.developer}
                        {r.rating ? ` · ★ ${r.rating.toFixed(1)}` : ""}
                      </div>
                    </div>
                    {picked?.storeId === r.storeId && <Check className="size-4" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label>Country</Label>
            <Select value={country || "auto"} onValueChange={(v) => setCountry(v === "auto" ? "" : v)}>
              <SelectTrigger className="w-full min-w-0" aria-label="Country">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (from link, else US)</SelectItem>
                {COUNTRIES.map(([code, name]) => (
                  <SelectItem key={code} value={code}>
                    {name} ({code.toUpperCase()})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Review language</Label>
            <Select value={lang} onValueChange={setLang}>
              <SelectTrigger className="w-full min-w-0" aria-label="Review language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (from country)</SelectItem>
                {LANGUAGES.map(([code, name]) => (
                  <SelectItem key={code} value={code}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">
          Google Play only returns reviews in the chosen language (Egypt → Arabic, Türkiye → Turkish by default). The App Store returns all
          languages.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit || pending}>
            {pending && <Spinner />}
            Add to library
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
