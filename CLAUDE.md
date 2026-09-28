# Storefront Lens — notes for agents

pnpm monorepo (Node 22, pnpm 10). Personal, self-hosted app-store reference library.

- `packages/core` holds all data logic (store clients, sync, diff, AI analysis, queries). Web, worker and MCP only call into it.
- `apps/web` is Next.js 16 App Router with shadcn/ui (new-york, neutral). UI primitives live in `components/ui` and come from the shadcn registry; do not restyle them ad hoc, compose them. Colors come from tokens in `app/globals.css` (`--success`, `--warning`, `--star` are project additions). Client components must not import runtime values from `@lens/core` (it pulls in `postgres`); type-only imports are fine.
- Mutations go through server actions in `apps/web/app/actions.ts`. Long work is queued with `enqueue()` and run by `apps/worker`.
- Schema changes: add a new numbered file in `db/migrations/`; never edit an applied one. The worker applies them on start.
- Postgres access uses `postgres` (porsager) with `prepare: false` for the Supabase transaction pooler. Cast `numeric`/`bigint` to `float8`/`int` in queries that return them.

Checks before pushing: `pnpm format:check && pnpm typecheck && TEST_DATABASE_URL=… pnpm test && pnpm build`.
