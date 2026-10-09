"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { LogOut, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { changePasswordAction, enablePinAction, logoutAction, removeDeviceAction } from "@/app/auth-actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CardContent, CardFooter } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ago, date } from "@/lib/format"

type Device = { id: string; name: string; createdAt: string; lastUsedAt: string | null; current: boolean }

/** "Chrome on macOS", from the user agent; only used to prefill the device name. */
function deviceName() {
  const ua = navigator.userAgent
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser"
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "device"
  return `${browser} on ${os}`
}

const digits = (v: string) => v.replace(/\D/g, "").slice(0, 6)

/** Receives only derived data: never the auth settings, hashes or secrets. */
export function SecurityCard({ passwordSet, devices, hasPinHere }: { passwordSet: boolean; devices: Device[]; hasPinHere: boolean }) {
  return (
    <>
      {passwordSet && <ChangePasswordForm />}
      <PinSection devices={devices} hasPinHere={hasPinHere} />
      <CardFooter className="justify-between gap-3 border-t">
        <p className="text-xs text-muted-foreground">Logging out keeps this device&apos;s PIN.</p>
        <form action={logoutAction}>
          <Button type="submit" variant="outline">
            <LogOut />
            Log out
          </Button>
        </form>
      </CardFooter>
    </>
  )
}

function ChangePasswordForm() {
  const [current, setCurrent] = React.useState("")
  const [next, setNext] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [pending, start] = React.useTransition()
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          const r = await changePasswordAction({ current, next, confirm })
          if (r.ok) {
            toast.success("Password changed. Other sessions were signed out.")
            setCurrent("")
            setNext("")
            setConfirm("")
          } else toast.error(r.error)
        })
      }}
    >
      <CardContent className="grid gap-4 pb-6">
        <h3 className="text-sm font-medium">Change password</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="pw-current">Current password</Label>
            <Input
              id="pw-current"
              type="password"
              autoComplete="current-password"
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pw-new">New password</Label>
            <Input
              id="pw-new"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pw-confirm">Confirm new password</Label>
            <Input
              id="pw-confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        </div>
        <div>
          <Button type="submit" disabled={pending}>
            {pending && <Spinner />}
            Change password
          </Button>
        </div>
      </CardContent>
    </form>
  )
}

function PinSection({ devices, hasPinHere }: { devices: Device[]; hasPinHere: boolean }) {
  const router = useRouter()
  const [name, setName] = React.useState("")
  const [pin, setPin] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [pending, start] = React.useTransition()
  const [removing, startRemove] = React.useTransition()
  React.useEffect(() => setName(deviceName()), [])
  return (
    <CardContent className="grid gap-4 border-t pt-6 pb-6">
      <h3 className="text-sm font-medium">PIN unlock</h3>
      <p className="text-sm text-muted-foreground">
        {hasPinHere
          ? "This device has a PIN. Setting a new one replaces it."
          : "Enable a 6-digit PIN on this device to sign in without typing the password."}{" "}
        PINs are per device. If a device is lost, remove it here. Five wrong PINs remove it automatically.
      </p>
      <form
        className="grid gap-4 sm:grid-cols-4 sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          start(async () => {
            const r = await enablePinAction({ name, pin, confirm })
            if (r.ok) {
              toast.success("PIN enabled on this device")
              setPin("")
              setConfirm("")
              router.refresh()
            } else toast.error(r.error)
          })
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="pin-name">Device name</Label>
          <Input id="pin-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="pin-new">PIN (6 digits)</Label>
          <Input
            id="pin-new"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            required
            minLength={6}
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(digits(e.target.value))}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="pin-confirm">Confirm PIN</Label>
          <Input
            id="pin-confirm"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            required
            minLength={6}
            maxLength={6}
            value={confirm}
            onChange={(e) => setConfirm(digits(e.target.value))}
          />
        </div>
        <Button type="submit" disabled={pending || pin.length !== 6}>
          {pending && <Spinner />}
          {hasPinHere ? "Replace PIN" : "Enable PIN on this device"}
        </Button>
      </form>
      {devices.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Device</TableHead>
              <TableHead>Added</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {devices.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">
                  {d.name} {d.current && <Badge variant="secondary">This device</Badge>}
                </TableCell>
                <TableCell>{date(d.createdAt)}</TableCell>
                <TableCell>{d.lastUsedAt ? ago(d.lastUsedAt) : "Never"}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={removing}
                    onClick={() =>
                      startRemove(async () => {
                        const r = await removeDeviceAction(d.id)
                        if (r.ok) toast.success("Device removed")
                        else toast.error(r.error)
                        router.refresh()
                      })
                    }
                  >
                    <Trash2 />
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </CardContent>
  )
}
