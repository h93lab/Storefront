/**
 * Checks database, worker, storage, both stores and the AI provider.
 *   pnpm doctor                         built-in sample apps
 *   pnpm doctor "<store link>"          test a specific app
 */
import { closeDb } from "../db"
import { runDiagnostics } from "../diagnostics"

const icons = { ok: "✓", warn: "!", fail: "✗", skip: "-" }
const checks = await runDiagnostics(process.argv[2])
for (const c of checks) console.log(`${icons[c.status]} ${c.name.padEnd(42)} ${String(c.ms).padStart(6)} ms  ${c.detail}`)
await closeDb()
process.exit(checks.some((c) => c.status === "fail") ? 1 : 0)
