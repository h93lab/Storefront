# Storefront Lens — notes for agents

pnpm monorepo (Node 22, pnpm 10). Personal, self-hosted app-store reference library.

- `packages/core` holds all data logic (store clients, sync, diff, AI analysis, queries). Web, worker and MCP only call into it.
- `apps/web` is Next.js 16 App Router with shadcn/ui (new-york, neutral). UI primitives live in `components/ui` and come from the shadcn registry; do not restyle them ad hoc, compose them. Colors come from tokens in `app/globals.css` (`--success`, `--warning`, `--star` are project additions). Client components must not import runtime values from `@lens/core` (it pulls in `postgres`); type-only imports are fine.
- Mutations go through server actions in `apps/web/app/actions.ts`. Long work is queued with `enqueue()` and run by `apps/worker`.
- Schema changes: add a new numbered file in `db/migrations/`; never edit an applied one. The worker applies them on start.
- Postgres access uses `postgres` (porsager) with `prepare: false` for the Supabase transaction pooler. Cast `numeric`/`bigint` to `float8`/`int` in queries that return them.
- Opportunities live in `packages/core/src/opportunities.ts`: evidence is reviews ∪ items, grouped by `opportunity_labels` on `lower(trim(label))`. The score is computed in SQL (`statsSelect`) and mirrored by `opportunityScore()`; change both together.
- Never call the model from `apps/mcp`. LLM work (analysis, `group_labels`, `generate_spec`, `analyse_items`) runs as worker jobs; MCP tools only enqueue.
- Model calls go through the provider dispatch in `packages/core/src/ai.ts`: use `chat()` and `embed()`, never the OpenAI path directly (`provider` may be `anthropic`).
- Batch classification is asynchronous: `submitClassificationBatch` writes `ai_batches`, and `pollBatches` (worker, every 60 s) applies results. Do not summarise or group before the results land; `pollBatches` queues those steps itself.
- pgvector objects (`label_embeddings`, `opportunities.centroid`) are optional and guarded. Check `to_regclass('label_embeddings')` before touching them and keep every feature working without them.
- Score weights come from Settings (`settings.score`). Change the formula in both `opportunityScore()` and `statsSelect`, and keep them fed from the same weights.
- Google Play apps are one row per `store_id` (reviews are not per country); iOS may be tracked per country. Count listings per `(store, store_id)`, never per app row.

Checks before pushing: `pnpm format:check && pnpm typecheck && TEST_DATABASE_URL=… pnpm test && pnpm build`.

Performance rules (measured with `packages/core/bench/sync.ts` over an 80 ms database link):

- Never write rows one at a time in a loop. Batch with `sql(rows)` or `unnest(...)`; each round trip to Supabase costs ~50–100 ms.
- Start independent page queries together (`Promise.all`); keep the app shell on `navSummary()`.
- Serve screenshots in grids through `mediaSrc(path, 240 | 480)` thumbnails, full size only in the lightbox.
- Poll `/api/jobs` via `<JobWatcher>` instead of refreshing whole pages.

Diagnosing a live install: Settings → Diagnostics, or `pnpm doctor "<store link>"`. Each app stores its last sync report in `apps.sync_report`.
