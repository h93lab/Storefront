# Storefront Lens

A private, self-hosted library of App Store and Google Play apps: listings, screenshots, reviews, AI review analysis, change tracking, project boards and an opportunity radar (H93) that groups recurring complaints and requests across apps into ranked product opportunities. It includes an MCP server so any AI agent can use the library.

- **Web UI**: Next.js 16 + [shadcn/ui](https://ui.shadcn.com) (neutral theme, light and dark)
- **Worker**: syncs every app on a schedule, detects changes, runs the AI analysis
- **MCP server**: 23 tools over Streamable HTTP, protected by a bearer token
- **Storage**: data in Supabase Postgres (or local Postgres); images as WebP on your server's disk

---

## دليل التشغيل (عربي)

### المطلوب

- سيرفر عليه Docker و Docker Compose
- مشروع مجاني على [Supabase](https://supabase.com)
- دومين على Cloudflare (عشان الـ Tunnel)

### 1) Supabase

1. اعمل مشروع جديد، واختار **Region** قريبة من السيرفر بتاعك (مثلًا Frankfurt لو السيرفر في أوروبا أو الشرق الأوسط). كل صفحة بتعمل كذا طلب للداتابيز، فالمسافة بتفرق في السرعة.
2. من زرار **Connect** فوق، اختار **Transaction pooler** وانسخ الـ connection string (port `6543`).
3. حط باسورد الداتابيز مكان `[YOUR-PASSWORD]`. لو الباسورد فيه رموز زي `@` أو `#` لازم تعملها URL-encode.

مش محتاج تعمل جداول. الـ worker بيعملها لوحده أول ما يشتغل.

### 2) ملف الإعدادات

```bash
git clone https://github.com/h93lab/Storefront.git storefront-lens
cd storefront-lens
cp .env.example .env
openssl rand -hex 32   # حط الناتج في MCP_TOKEN
```

افتح `.env` واملا:

| المتغير                   | القيمة                                                      |
| ------------------------- | ----------------------------------------------------------- |
| `DATABASE_URL`            | الـ connection string من Supabase                           |
| `PUBLIC_URL`              | دومين الواجهة، مثلًا `https://lens.example.com`             |
| `PUBLIC_MCP_URL`          | دومين الـ MCP، مثلًا `https://mcp.example.com/mcp`          |
| `MCP_TOKEN`               | الناتج من `openssl rand -hex 32`                            |
| `CLOUDFLARE_TUNNEL_TOKEN` | من الخطوة 4                                                 |
| `TZ`                      | المنطقة الزمنية لميعاد التحديث اليومي، مثلًا `Africa/Cairo` |

### 3) التشغيل

```bash
docker compose up -d --build
```

- الواجهة: `http://localhost:3000`
- الـ MCP: `http://localhost:3001/mcp`

الاتنين متاحين على السيرفر نفسه بس (`127.0.0.1`). الوصول من برا بيكون عن طريق الـ Tunnel.

عايز تشوف المنصة بداتا تجريبية قبل ما تضيف تطبيقات حقيقية؟

```bash
docker compose run --rm -w /app/packages/core worker node_modules/.bin/tsx src/cli/seed.ts
```

(بيضيف 4 تطبيقات وهمية باسم Demo Studio. تشيلها كلها بنفس الأمر مع `--remove` في الآخر، أو واحدة واحدة من قايمة ⋯ على كل كارت.)

### 4) Cloudflare Tunnel

1. Cloudflare dashboard → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel** → اختار **Cloudflared**.
2. انسخ الـ token وحطه في `CLOUDFLARE_TUNNEL_TOKEN` في `.env`.
3. في **Public hostnames** ضيف اتنين:
   - `lens.example.com` ← Service: `HTTP` ← URL: `web:3000`
   - `mcp.example.com` ← Service: `HTTP` ← URL: `mcp:3001`
4. شغّل الـ tunnel:

```bash
docker compose --profile tunnel up -d
```

### 5) الحماية (مهم)

- **الواجهة**: Zero Trust → **Access** → **Applications** → **Add an application** → **Self-hosted** → الدومين `lens.example.com` → Policy: **Allow** لإيميلك بس.
- **الـ MCP**: ماتحطش عليه Cloudflare Access، لأن الـ AI clients مش هتعرف تعدّي شاشة الدخول. هو محمي بالـ `MCP_TOKEN`.
- اختياري: `BASIC_AUTH_USER` و `BASIC_AUTH_PASSWORD` في `.env` بيضيفوا باسورد تاني على الواجهة.

### 6) الـ AI

من **Settings** في المنصة حط أي endpoint متوافق مع OpenAI: الـ Base URL والـ API key والموديل، وبعدين دوس **Test connection**.

أمثلة للـ Base URL:

- OpenRouter: `https://openrouter.ai/api/v1`
- OpenAI: `https://api.openai.com/v1`
- Ollama على نفس السيرفر: `http://host.docker.internal:11434/v1` (محتاج `extra_hosts` في compose) أو ضيف Ollama كـ service في نفس الـ compose واستخدم `http://ollama:11434/v1`

بعد كده التعليقات الجديدة بتتحلل لوحدها بعد كل sync. بيتبعت بس اللي ماتحللش قبل كده، فالتكلفة بتفضل قليلة.

### 7) ربط الـ MCP بـ Claude

Claude Code:

```bash
claude mcp add --transport http storefront-lens https://mcp.example.com/mcp --header "Authorization: Bearer <MCP_TOKEN>"
```

Claude Desktop و Cursor وغيرهم (JSON):

```json
{
  "mcpServers": {
    "storefront-lens": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer <MCP_TOKEN>" }
    }
  }
}
```

لو الـ client مابيقدرش يبعت headers، استخدم اللينك ده بدلها (خليه سر): `https://mcp.example.com/mcp/<MCP_TOKEN>`

صفحة **Settings** في المنصة فيها الأوامر دي جاهزة للنسخ.

### 8) النسخ الاحتياطي

```bash
./scripts/backup.sh
```

بيحفظ الداتابيز والصور في `backups/`. مع Supabase لازم `DATABASE_BACKUP_URL` في `.env` يكون الـ **Session pooler** (port `5432`)، لأن `pg_dump` مابيشتغلش على الـ transaction pooler.

### 9) الفرص (H93)

الفرصة (opportunity) هي شكوى أو طلب بيتكرر في تعليقات أكتر من تطبيق، يعني حاجة ناقصة الناس عايزاها ("Offline mode — sleep stories" مثلاً). المنصة بتجمع كل التعليقات المتشابهة تحت فرصة واحدة وبترتبها بسكور.

الخطوات:

1. ضيف التطبيقات المنافسة واستنى الـ sync.
2. التحليل بيشتغل لوحده بعد الـ sync (لازم الـ AI يكون متظبط في Settings).
3. بعد التحليل بيتشغل تجميع الـ labels (`group_labels`) لوحده، وكمان كل ليلة مع الـ sync. تقدر تشغله بإيدك من صفحة الفرص.
4. افتح **/opportunities**. الفرص مترتبة بالسكور، وكل فرصة فيها الاقتباسات الحرفية من التعليقات.

جوه أي فرصة:

- **الـ Gate**: 8 أسئلة نعم/لا تجاوب عليها قبل ما تبني. لو فشلت في `permissions` أو `single_player` أو `data_legal` يبقى الفكرة تتقتل، مش تتعاد.
- **Generate spec**: بيكتب لك مواصفات بناء كاملة (Markdown) من الأدلة، بتلاقيها في تاب Spec وتقدر تنسخها أو تنزلها.
- **Import** (صفحة `/import`): الزق نصوص من بره المتاجر (Reddit، إيميلات دعم، منتديات). بتتحلل وبتدخل كأدلة مع التعليقات. النص المكرر بيتتجاهل.
- **This is my app**: من صفحة التطبيق علّم تطبيقك انت. أدلته بتتشال من قوائم الفرص لحد ما تختار "own only".

نصيحة: لو التطبيق على iOS وعايز تغطي أكتر من دولة، ضيفه مرة لكل دولة (الـ store id واحد). الفرصة بتعدّ التطبيق مرة واحدة بس مهما كان عدد الدول. أما Google Play فالتعليقات مش بتختلف بالدولة، فالتطبيق بيتضاف مرة واحدة بس، ولو حاولت تضيفه بدولة تانية هيرفض. غيّر لغة التعليقات بدل كده.

الفرص اللي تقتلها بتفضل مخفية (المقبرة)، وأي label جديد بنفس المعنى بيتربط بيها تلقائي ومش بيرجع يظهر كفرصة مكررة.

### التحديث

```bash
git pull && docker compose up -d --build
```

الـ migrations بتتطبق لوحدها.

### لو في مشكلة: التشخيص

افتح **Settings → Diagnostics** ودوس **Run diagnostics**. ولو المشكلة في تطبيق معين، الزق اللينك بتاعه الأول. هيختبر من السيرفر نفسه:

- **الداتابيز:** سرعة كل طلب. لو أكتر من 120ms، الصفحات هتبقى بطيئة، والحل region أقرب في Supabase.
- **الـ worker:** شغال ولا لأ، وفيه jobs عالقة ولا لأ.
- **مساحة الصور:** الديسك بيتكتب عليه، وفاضل فيه قد إيه.
- **الـ App Store:** بيانات التطبيق والتعليقات، وبيقولك جت من أنهي مصدر.
- **Google Play:** بيانات التطبيق والتعليقات.
- **الـ AI:** الاتصال بالـ provider بتاعك.

نفس الفحص من الـ terminal:

```bash
docker compose exec worker node_modules/.bin/tsx ../../packages/core/src/cli/doctor.ts "https://apps.apple.com/tr/app/id1312926037"
```

**مشاكل شائعة:**

| المشكلة                                          | السبب والحل                                                                                                                                                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reviews 0 لتطبيق App Store**                   | افتح التطبيق وشوف كارت **Last sync**. هتلاقي فيه أنهي مصدر اتجرب وإيه اللي رجع. المنصة بتجرب RSS feed الأول، ولو رجع فاضي أو اتقفل بتجرب الـ web API بتاع apps.apple.com. لو الاتنين فشلوا هتظهر رسالة الخطأ فوق التابات. |
| **Reviews 0 لتطبيق Google Play**                 | جوجل بيرجّع التعليقات المكتوبة بلغة واحدة بس. غيّر **Review language** من Overview → Details، وهيتعمل sync تاني لوحده.                                                                                                    |
| **الصفحات بطيئة**                                | شوف سطر **Database round trip** في الـ Diagnostics.                                                                                                                                                                       |
| **الـ sync مابيبدأش ("Waiting for the worker")** | الـ worker واقف: `docker compose logs worker`.                                                                                                                                                                            |
| **"will retry at …"**                            | خطأ مؤقت، زي إن المتجر رفض الطلب لحظيًا. الـ job هيتعاد لوحده لحد 3 مرات.                                                                                                                                                 |

### حدود لازم تعرفها

- **Google Play مالوش API رسمي.** السحب بيتم بمكتبة `google-play-scraper`، ولو جوجل غيّرت الصفحة ممكن يقف لحد ما المكتبة تتحدث (`pnpm up google-play-scraper` وبعدين rebuild).
- **الـ App Store** بيستخدم الـ iTunes Lookup/Search API الرسمية وفيد التعليقات RSS، وده بيدي 500 تعليق كحد أقصى لكل دولة. لو الفيد فاضي أو اتقفل، المنصة بتستخدم الـ web API بتاع apps.apple.com. ده مش API رسمي موثق، فممكن يتغير.
- **صور المتجر** صور تسويقية، مش شاشات التطبيق الحقيقية من جوه.
- **المحتوى ملك أصحابه.** المنصة معمولة كمرجع شخصي ليك، مش لإعادة النشر.

---

## Reference (English)

### Architecture

```
apps/web      Next.js UI (shadcn/ui), server actions, /media route for stored images
apps/worker   Job runner + cron schedule (croner). Runs migrations on start.
apps/mcp      Stateless MCP server (Streamable HTTP, JSON responses), bearer-token auth
packages/core Store clients, sync pipeline, change detection, AI analysis, opportunities.ts (label grouping, evidence, score, gate, specs), queries
db/migrations SQL schema, applied automatically
```

The web app and the MCP server enqueue jobs in the `jobs` table; the worker claims them with `FOR UPDATE SKIP LOCKED`. All three share the `data/media` volume.

**Sync pipeline** (per app): fetch listing → download icon and screenshots in parallel (content-addressed WebP, unchanged images are not re-downloaded) while reviews are fetched → batch-upsert the latest N reviews → compare with the previous snapshot and record changes (name, description, release notes, price, version, icon, screenshots) → record the day's rating → store a sync report on the app → queue AI analysis if new reviews arrived. Database writes are batched, so a sync costs a handful of round trips regardless of review count (`pnpm --filter @lens/core bench` measures it against any database).

**App Store reviews** come from the customer-reviews RSS feed; if it is empty or blocked, from the web API behind apps.apple.com (using the public token the site embeds). The sync report records which one was used.

**Jobs** report live progress, retry transient failures (timeouts, 429, 5xx, network) up to 3 times with backoff, and run two at a time without ever syncing the same app twice. A job interrupted by a restart is requeued on the next start.

**AI analysis**: unanalysed reviews go to the configured model in batches of 20 (three in parallel) and come back with sentiment, one of 11 fixed topics, a short complaint/request label, and opportunity signals: a willingness-to-pay signal (`paying_competitor`, `churned`, `workaround`, `stated_wtp` or `none`), any competitor named, the workaround described, a verbatim evidence quote (dropped unless it appears in the review word for word) and a pain score 0–5. The model's raw item is kept in `reviews.raw_analysis`. A second call merges similar labels into the top complaints and requests and writes a short summary. Each review records the `analysis_version` it was classified with; when the classifier changes, **Settings → Re-analyse all apps** (or the `analyse_all` job) sends older rows through again.

### Opportunities (H93)

**Model.** An opportunity is one recurring missing capability ("Offline mode — sleep stories"). The `group_labels` job takes every distinct `lower(trim(label))` of complaint/request reviews and imported items that is not yet in `opportunity_labels`, and asks the model (batches of 120) to map each onto an existing opportunity or to form new ones. There are no embeddings. Canonical labels are `<missing capability> — <context>`, at most 60 characters, without app names. A label the model skips becomes an opportunity of its own; replies that are not valid JSON fall back to one opportunity per label. Evidence is the union of reviews and items joined through `opportunity_labels`. Merging two opportunities moves all labels onto one.

**Score.** `recent × (1 + 0.5 × (listings − 1)) × (1 + avg_pain / 5) × (1 + 2 × wtp_share)`. `recent` is the evidence count weighted by a 90-day half-life (undated evidence counts as 180 days old). `listings` is the number of distinct `(store, store_id)` pairs with evidence (minimum 1), so one app tracked in five countries counts once. `avg_pain` is the mean pain score 0–5. `wtp_share` is the share of evidence whose signal is `paying_competitor`, `churned`, `workaround` or `stated_wtp`. The same formula lives in SQL (`statsSelect`) and in `opportunityScore()`. Lists exclude your own apps by default (`own`: `exclude`, `only`, `all`) and hide opportunities without evidence in the chosen view.

**Gate.** Eight yes/no checks, saved with `checked_at` and notes. PASS means:

| Key             | PASS                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------ |
| `scope`         | Solo-dev scope: ≤4 weeks, ≤6 screens, ≤3 tables, no native modules                         |
| `permissions`   | Works within iOS/Android foreground limits; no closed APIs or scraping                     |
| `single_player` | Valuable to user #1 alone (no marketplace/social)                                          |
| `monetization`  | One clear paid model; users already pay a competitor or a workaround                       |
| `demand`        | Competitor ≥1k ratings and ≤3.8★, or ≥15 independent complaints from 2+ sources in 90 days |
| `distribution`  | The threads/subreddits/keyword where the pain lives allow launching there                  |
| `data_legal`    | No sensitive PII (medical, financial credentials, minors), no copyrighted ingestion        |
| `founder_fit`   | You can use it daily yourself                                                              |

Failing `permissions`, `single_player` or `data_legal` is permanent: kill the idea instead of retrying.

**Statuses.** `surfaced → validating → building → shipped → killed`. Killing stores a reason and an optional revisit date; any other status clears both. Killed opportunities are the graveyard: they stay in the list sent to the grouping model, so new labels that mean the same thing map onto them and stay hidden (default view is everything except killed). `record_outcome` stores installs, trial starts and paying customers for shipped ideas; day-60 kill criteria are under 100 installs, under 2% trial starts, or under 1 paying customer per 100 installs.

**Spec.** `generate_spec` sends the 12 strongest quotes (willingness-to-pay signal, then pain) plus the stats, competitors and your notes to the model, and stores Markdown with nine sections: 1 Problem in the users' words (quotes Q1..Qn), 2 Target user and trigger moment, 3 MVP scope (exactly 5 features with Given/When/Then), 4 Non-goals, 5 Data model (Supabase SQL with RLS), 6 Screens and navigation, 7 Monetization, 8 Definition of done, 9 Task plan (tasks ≤2 hours). Default stack: Expo (React Native + TypeScript) + Supabase + RevenueCat + EAS. Agents can also write their own with `save_spec`.

**Import and items.** `/import` and the `import_items` tool store outside text (paste, reddit, support, other) in `items`. A duplicate is the same `source` with the same normalised body (`md5(lower(whitespace-collapsed body))`) and is skipped. Items go through the same classifier as reviews (`analysis_version` 2), then labels are grouped.

**Own apps.** **This is my app** on an app page (`setAppOwn`) marks it as yours; its reviews are left out of opportunity lists and `search_reviews` unless you ask for `own=only`. Google Play is one row per `store_id` (adding a second country is refused, change the review language instead); iOS can be tracked per country.

**Jobs.** `group_labels` maps new labels (queued after a review analysis or item analysis classifies anything, from the opportunities page, and nightly after `sync_all` on the sync cron); `generate_spec` (payload `opportunityId`) is queued by the Generate spec button; `analyse_items` runs after an import; `analyse_all` re-analyses apps classified by an older `ANALYSIS_VERSION`. The MCP server never calls the model itself, it only enqueues these jobs.

### MCP tools

| Tool                                                        | Purpose                                              |
| ----------------------------------------------------------- | ---------------------------------------------------- |
| `search_library`                                            | List tracked apps (filter by text, store, category)  |
| `get_app`                                                   | Full listing plus an insights summary                |
| `get_screenshots`                                           | Screenshot list, optionally including removed ones   |
| `view_screenshot`                                           | Returns the image itself so the agent can look at it |
| `get_reviews`                                               | Reviews filtered by rating, AI topic, text; sorted   |
| `get_insights`                                              | Sentiment, top complaints, top requests, summary     |
| `get_changes`                                               | Detected listing changes                             |
| `compare_apps`                                              | Side-by-side facts for 2–8 apps                      |
| `search_store`                                              | Search App Store / Google Play                       |
| `add_app`                                                   | Add by link or id and queue the first sync           |
| `sync_app`                                                  | Queue a sync now                                     |
| `list_boards`, `get_board`, `create_board`, `save_to_board` | Project boards                                       |
| `list_opportunities`                                        | Opportunities ranked by score, with evidence stats   |
| `get_opportunity`                                           | One opportunity: quotes, labels, gate, spec, outcome |
| `search_reviews`                                            | Cross-app search over reviews and imported items     |
| `save_gate_result`                                          | Record the eight-check validation gate               |
| `save_spec`                                                 | Store a Markdown build spec on an opportunity        |
| `set_opportunity_status`                                    | Move status; killing takes a reason and revisit date |
| `record_outcome`                                            | Record installs, trial starts, paying customers      |
| `import_items`                                              | Import outside text as evidence (deduplicated)       |

### Development

Requires Node 22 and pnpm 10.

```bash
pnpm install
docker run -d --name lens-pg -e POSTGRES_PASSWORD=lens -e POSTGRES_DB=lens -p 5433:5432 postgres:16-alpine
export DATABASE_URL=postgres://postgres:lens@localhost:5433/lens MEDIA_DIR=./data/media MCP_TOKEN=dev-token-0123456789abcdefgh
pnpm migrate && pnpm seed
pnpm dev:web      # http://localhost:3000
pnpm dev:worker
pnpm dev:mcp      # http://localhost:3001/mcp
```

Checks:

```bash
pnpm format:check
pnpm typecheck
TEST_DATABASE_URL=postgres://postgres:lens@localhost:5433/lens_test pnpm test   # the test database is wiped
node apps/mcp/test/smoke.mjs http://localhost:3001/mcp $MCP_TOKEN              # needs seeded data
pnpm doctor "<store link>"                                                     # live checks against the stores
```

Adding shadcn components: `cd apps/web && npx shadcn@latest add <component>` (see `components.json`).

### Environment variables

| Variable                                 | Used by       | Notes                                                                                                          |
| ---------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                           | all           | Postgres URL. SSL is required automatically for non-local hosts (`DATABASE_SSL=disable\|require` to override). |
| `MEDIA_DIR`                              | all           | Set to `/data/media` in the containers                                                                         |
| `PUBLIC_URL`                             | mcp           | Base for absolute image links returned by MCP tools                                                            |
| `PUBLIC_MCP_URL`, `MCP_TOKEN`            | web, mcp      | Shown on the Settings page; `MCP_TOKEN` must be at least 24 characters                                         |
| `TZ`                                     | worker, web   | Time zone for the cron schedule                                                                                |
| `BASIC_AUTH_USER`, `BASIC_AUTH_PASSWORD` | web           | Optional extra login                                                                                           |
| `CLOUDFLARE_TUNNEL_TOKEN`                | cloudflared   | Only with `--profile tunnel`                                                                                   |
| `DATABASE_BACKUP_URL`                    | backup script | Session-pooler URL for `pg_dump`                                                                               |
| `DATABASE_POOL_SIZE`                     | all           | Connections per process (default 10)                                                                           |
| `WORKER_CONCURRENCY`                     | worker        | Jobs run at once (default 2)                                                                                   |
| `WORKER_JOB_TIMEOUT_MS`                  | worker        | A job running longer is failed and retried (default 15 min)                                                    |

### Using a local database instead of Supabase

Set `DATABASE_URL=postgres://lens:lens@db:5432/lens` and start with `docker compose --profile localdb up -d --build`. Data lives in `data/postgres`.
