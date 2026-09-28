import { closeDb } from "../db"
import { migrate } from "../migrate"

await migrate()
console.log("migrations up to date")
await closeDb()
