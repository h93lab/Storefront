import { listBoards } from "@lens/core"
import type { BoardOption } from "@/components/save-to-board"

export async function boardOptions(): Promise<BoardOption[]> {
  return (await listBoards()).map((b) => ({ id: b.id, name: b.name, count: b.screens + b.reviews }))
}
