// Dev helper: runs the fake Appllama server standalone so the web app and worker can be
// exercised end to end. `pnpm --filter @lens/core exec tsx test/fake-appllama-run.ts`
import { startFakeAppllama } from "./fake-appllama"

const fake = await startFakeAppllama()
console.log(JSON.stringify({ mcpUrl: fake.mcpUrl, base: fake.base }))
setInterval(() => {}, 1 << 30)
