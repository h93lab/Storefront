"use client"

import * as React from "react"
import { toast } from "sonner"
import { loginAction, pinLoginAction, setupAction, type AuthResult } from "@/app/auth-actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"

function describe(r: Extract<AuthResult, { ok: false }>) {
  if (!r.lockedUntil) return r.error
  const at = new Date(r.lockedUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  return `${r.error} Locked until ${at}.`
}

export function SetupForm({ next }: { next: string }) {
  const [password, setPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, start] = React.useTransition()
  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setError(null)
          start(async () => {
            const r = await setupAction({ password, confirm, next })
            if (r.ok) window.location.assign(r.next)
            else setError(describe(r))
          })
        }}
      >
        <CardHeader>
          <CardTitle>Set a password</CardTitle>
          <CardDescription>First run. Choose the password that protects this library (at least 8 characters).</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="setup-password">Password</Label>
            <Input
              id="setup-password"
              type="password"
              autoComplete="new-password"
              autoFocus
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="setup-confirm">Confirm password</Label>
            <Input
              id="setup-confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending && <Spinner />}
            Set password and sign in
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}

export function LoginForm({ next, hasPin }: { next: string; hasPin: boolean }) {
  const [mode, setMode] = React.useState<"pin" | "password">(hasPin ? "pin" : "password")
  const [pinOk, setPinOk] = React.useState(hasPin)
  return mode === "pin" ? (
    <PinForm
      next={next}
      onPassword={(removed) => {
        if (removed) setPinOk(false)
        setMode("password")
      }}
    />
  ) : (
    <PasswordForm next={next} onPin={pinOk ? () => setMode("pin") : undefined} />
  )
}

function PasswordForm({ next, onPin }: { next: string; onPin?: () => void }) {
  const [password, setPassword] = React.useState("")
  const [remember, setRemember] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, start] = React.useTransition()
  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setError(null)
          start(async () => {
            const r = await loginAction({ password, remember, next })
            if (r.ok) window.location.assign(r.next)
            else {
              setError(describe(r))
              setPassword("")
            }
          })
        }}
      >
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Enter your password to open the library.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="login-password">Password</Label>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="login-remember" checked={remember} onCheckedChange={setRemember} />
            <Label htmlFor="login-remember">Remember me for 30 days</Label>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </CardContent>
        <CardFooter className="flex-col gap-2">
          <Button type="submit" className="w-full" disabled={pending}>
            {pending && <Spinner />}
            Sign in
          </Button>
          {onPin && (
            <Button type="button" variant="ghost" className="w-full" onClick={onPin}>
              Use PIN instead
            </Button>
          )}
        </CardFooter>
      </form>
    </Card>
  )
}

function PinForm({ next, onPassword }: { next: string; onPassword: (removed?: boolean) => void }) {
  const [pin, setPin] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, start] = React.useTransition()
  const submit = (value: string) => {
    setError(null)
    start(async () => {
      const r = await pinLoginAction({ pin: value, next })
      if (r.ok) return window.location.assign(r.next)
      setPin("")
      if (r.removed) {
        toast.error(r.error)
        onPassword(true)
      } else setError(describe(r))
    })
  }
  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (pin.length === 6) submit(pin)
        }}
      >
        <CardHeader>
          <CardTitle>Enter your PIN</CardTitle>
          <CardDescription>The 6-digit PIN you set up on this device.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 py-4">
          <Label htmlFor="login-pin" className="sr-only">
            PIN
          </Label>
          <Input
            id="login-pin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="one-time-code"
            autoFocus
            disabled={pending}
            className="h-12 text-center font-mono text-2xl tracking-[0.5em]"
            value={pin}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 6)
              setPin(v)
              if (v.length === 6) submit(v)
            }}
          />
          {error && (
            <p role="alert" className="text-center text-sm text-destructive">
              {error}
            </p>
          )}
        </CardContent>
        <CardFooter className="flex-col gap-2">
          <Button type="submit" className="w-full" disabled={pending || pin.length !== 6}>
            {pending && <Spinner />}
            Unlock
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => onPassword()}>
            Use password instead
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
