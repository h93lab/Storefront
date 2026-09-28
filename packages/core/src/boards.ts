import { db } from "./db"

export interface Board {
  id: string
  name: string
  description: string | null
  created_at: Date
  screens: number
  reviews: number
  preview: string[]
}

export interface BoardItem {
  id: string
  kind: "screenshot" | "review"
  note: string | null
  created_at: Date
  app_id: string
  app_name: string
  app_store: string
  screenshot_id: string | null
  screenshot_path: string | null
  review_id: string | null
  review_rating: number | null
  review_title: string | null
  review_body: string | null
}

export async function listBoards() {
  return db()<Board[]>`
    select b.id, b.name, b.description, b.created_at,
      (select count(*)::int from board_items i where i.board_id = b.id and i.kind = 'screenshot') as screens,
      (select count(*)::int from board_items i where i.board_id = b.id and i.kind = 'review') as reviews,
      coalesce((select array_agg(path) from (
        select s.path from board_items i join screenshots s on s.id = i.screenshot_id
        where i.board_id = b.id order by i.created_at desc limit 4) p), '{}') as preview
    from boards b order by b.created_at desc`
}

export async function getBoard(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const sql = db()
  const [board] = await sql<
    Omit<Board, "screens" | "reviews" | "preview">[]
  >`select id, name, description, created_at from boards where id = ${id}`
  if (!board) return null
  const items = await sql<BoardItem[]>`
    select i.id::text, i.kind, i.note, i.created_at, i.app_id, a.name as app_name, a.store as app_store,
      i.screenshot_id::text, s.path as screenshot_path, i.review_id,
      r.rating as review_rating, r.title as review_title, r.body as review_body
    from board_items i
    join apps a on a.id = i.app_id
    left join screenshots s on s.id = i.screenshot_id
    left join reviews r on r.app_id = i.app_id and r.review_id = i.review_id
    where i.board_id = ${id} order by i.created_at desc`
  return { ...board, items }
}

export async function createBoard(name: string, description?: string | null) {
  const clean = name.trim()
  if (!clean) throw new Error("Board name is required")
  const [row] = await db()<
    { id: string }[]
  >`insert into boards (name, description) values (${clean.slice(0, 120)}, ${description?.trim() || null}) returning id`
  return row.id
}

export async function updateBoard(id: string, name: string, description?: string | null) {
  await db()`update boards set name = ${name.trim().slice(0, 120)}, description = ${description?.trim() || null} where id = ${id}`
}

export async function deleteBoard(id: string) {
  await db()`delete from boards where id = ${id}`
}

export type NewBoardItem =
  | { kind: "screenshot"; screenshotId: string; note?: string | null }
  | { kind: "review"; appId: string; reviewId: string; note?: string | null }

export async function addBoardItem(boardId: string, item: NewBoardItem) {
  const sql = db()
  if (item.kind === "screenshot") {
    const [s] = await sql<{ app_id: string }[]>`select app_id from screenshots where id = ${item.screenshotId}`
    if (!s) throw new Error("Screenshot not found")
    const [dup] = await sql`select 1 from board_items where board_id = ${boardId} and screenshot_id = ${item.screenshotId}`
    if (dup) return null
    const [row] = await sql<{ id: string }[]>`insert into board_items (board_id, kind, app_id, screenshot_id, note)
      values (${boardId}, 'screenshot', ${s.app_id}, ${item.screenshotId}, ${item.note?.trim() || null}) returning id::text`
    return row.id
  }
  const [r] = await sql`select 1 from reviews where app_id = ${item.appId} and review_id = ${item.reviewId}`
  if (!r) throw new Error("Review not found")
  const [dup] = await sql`select 1 from board_items where board_id = ${boardId} and review_id = ${item.reviewId} and app_id = ${item.appId}`
  if (dup) return null
  const [row] = await sql<{ id: string }[]>`insert into board_items (board_id, kind, app_id, review_id, note)
    values (${boardId}, 'review', ${item.appId}, ${item.reviewId}, ${item.note?.trim() || null}) returning id::text`
  return row.id
}

export async function removeBoardItem(itemId: string) {
  await db()`delete from board_items where id = ${itemId}`
}
