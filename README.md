# Storefront Lens

A private, self-hosted library of App Store and Google Play apps: listings, screenshots, reviews, AI review analysis, change tracking, project boards and an opportunity radar (H93) that groups recurring complaints and requests across apps into ranked product opportunities. It includes an MCP server so any AI agent can use the library.

- **Web UI**: Next.js 16 + [shadcn/ui](https://ui.shadcn.com) (neutral theme, light and dark)
- **Worker**: syncs every app on a schedule, detects changes, runs the AI analysis
- **MCP server**: 32 tools over Streamable HTTP, protected by a bearer token
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
openssl rand -hex 32   # ونفّذه تاني وحط الناتج في SESSION_SECRET
```

افتح `.env` واملا:

| المتغير                   | القيمة                                                      |
| ------------------------- | ----------------------------------------------------------- |
| `DATABASE_URL`            | الـ connection string من Supabase                           |
| `PUBLIC_URL`              | دومين الواجهة، مثلًا `https://lens.example.com`             |
| `PUBLIC_MCP_URL`          | دومين الـ MCP، مثلًا `https://mcp.example.com/mcp`          |
| `MCP_TOKEN`               | الناتج من `openssl rand -hex 32`                            |
| `SESSION_SECRET`          | مطلوب. ناتج `openssl rand -hex 32` تاني (32 حرف على الأقل)  |
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
- **تسجيل الدخول**: الواجهة ليها صفحة دخول بباسورد واحد (مفيش popup). أول مرة تفتح الواجهة هتحوّلك لصفحة `/setup` تختار فيها الباسورد (8 حروف على الأقل)، وبعدها بتدخل بيه من `/login`. لازم `SESSION_SECRET` يكون متظبط في `.env`، لو ناقص أو أقل من 32 حرف الواجهة بترفض تفتح وبتقول ليه.
- **Remember me** بيخلّي الجلسة 30 يوم، من غيره 12 ساعة. تغيير الباسورد من **Settings → Security** بيطلّع كل الجلسات التانية.
- **PIN لكل جهاز**: من **Settings → Security** فعّل PIN من 6 أرقام على الجهاز اللي معاك، وبعدها صفحة الدخول على الجهاز ده بتسألك عن الـ PIN الأول. لو الجهاز اتفقد شيله من نفس الجدول. 5 PIN غلط بيمسحوا الـ PIN بتاع الجهاز تلقائيًا.
- **القفل**: 5 باسوردات غلط بيقفلوا الدخول دقيقة، وبعدها المدة بتتضاعف لحد 15 دقيقة. الباسورد الصح بيصفّر العدّاد.
- **تسجيل الخروج** من آخر القايمة الجانبية أو من Settings → Security.
- الـ MCP لسه بالـ `MCP_TOKEN` زي ما هو، ومش بيتأثر بالباسورد.
- لسه يُنصح بـ Cloudflare Access كطبقة خارجية فوق صفحة الدخول.

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

### 10) الفرص: المزوّد، الـ embeddings، Reddit والمراجعة

كل الإعدادات دي من **Settings** في المنصة. مفيش أي حاجة جديدة في `.env`.

**اختيار المزوّد**: في كارت **AI provider** اختار `anthropic` لو عايز تكلم Anthropic مباشرة، أو سيبه OpenAI-compatible زي ما هو. مع Anthropic تقدر تفعّل **Message Batches**: التصنيف بيتبعت دفعة واحدة وبيتحاسب بنص السعر (أرخص 50%)، بس النتيجة مش فورية. الدفعة بتخلص في العادي خلال دقايق لحد ساعات، والـ worker بيسأل عليها كل دقيقة ولما تخلص بيطبّق النتايج لوحده ويكمّل الملخص وتجميع الـ labels. ملاحظة الـ caching: الـ system prompt متعلّم للـ cache، بس Haiku 4.5 محتاج prefix لا يقل عن 4096 token عشان الـ cache يشتغل، أما Sonnet 5.5 و Opus 5.5 فمحتاجين 512 بس، يعني الفايدة أكبر مع الموديلات الكبيرة.

**الـ embeddings (اختياري)**: من كارت **Embeddings** حط Base URL وKey وموديل. بيشتغل مع Voyage (`https://api.voyageai.com/v1`) أو OpenAI (`https://api.openai.com/v1`). لازم الـ dimensions تبقى 1024. لو سبت الـ Base URL فاضي الميزة بتقفل والتجميع بيعتمد على الموديل بس. بيدمج الليبلز المتشابهة تلقائي، وبيكشف لو الـ label الجديد شبه فكرة اتقتلت قبل كده (المقبرة) فمابيرجعهاش. تاب الفرصة بيعرض كمان الفرص المشابهة. محتاج إضافة pgvector في الداتابيز، ولو مش موجودة كل حاجة تانية بتشتغل عادي.

**أوزان الـ score**: كارت **Scoring** فيه وزن التطبيقات (`listingWeight`) ووزن الألم (`painWeight`) ووزن الدفع (`wtpWeight`) ونص عمر التعليق بالأيام (`halfLifeDays`) وحد الربط التلقائي بالـ embeddings (`autoMapThreshold`). أي تغيير بيتطبق فوراً على كل القوايم.

**Reddit**: من [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) اضغط **create another app** واختار النوع **script**، وحط أي redirect uri (مثلاً `http://localhost`). خد الـ client id (تحت اسم الـ app) والـ secret، وحطهم في كارت **Reddit** في Settings مع User-Agent يعرّف بيك (مثلاً `storefront-lens/1.0 by u/اسمك`) وقائمة الـ subreddits والكلمات المفتاحية. الاستخدام لازم يكون شخصي وغير تجاري، حسب سياسة Reddit للـ Data API، ومن غير موافقتهم مايتخطاش كده. الـ worker بيسحب البوستات المطابقة كل ليلة، وبيبعت طلب واحد كل 700 ms بس.

**صفحة Review (`/review`)**: بتوريك تعليقات مصنّفة وانت تحكم إن التصنيف صح ولا غلط، ولو غلط تصححه (الإشارة، النوع، الألم، الـ label) والتصحيح بيتكتب على التعليق نفسه. الصفحة بتحسب دقة المصنّف من الأحكام دي، إجمالي وحسب الإشارة والنوع. الهدف تحكم على **200 عنصر** على الأقل عشان الرقم يبقى ليه معنى. ابدأ بالعناصر اللي فيها إشارة دفع.

**تاب Validation**: داخل أي فرصة دوس Generate عشان يطلّع لك kit جاهز للـ fake-door test (عنوان، نقط، زرار، سعر، رد على thread، نص الـ waitlist). بعد ما تنشره سجّل الأرقام: `waitlist` و`price_clicks` و`replies` وتاريخ البداية. القرار:

- **proceed** لو الـ waitlist 20 أو أكتر، أو نقرات السعر 5 أو أكتر، أو الردود 3 أو أكتر.
- **kill** لو مفيش ولا واحدة منهم وعدى 5 أيام أو أكتر من البداية.
- غير كده **pending**.

**عرض Outcomes**: في **/opportunities** دوس Outcomes عشان تشوف الفرص اللي اتشحنت أو اتقتلت جنب السكور والـ Gate والـ Validation وأرقام التثبيتات والتجارب والعملاء.

### 11) السوق (Appllama)

صفحة **/market** بتجيب لك بيانات السوق (الإيراد، التحميلات، الأسعار) وكل شاشات التطبيقات اللي بتدرسها، من اشتراكك في Appllama Pro. مفيش API key: بتسجّل دخول مرة واحدة بس.

1. افتح **Settings** ثم كارت **Appllama** واضغط **Connect**. هيفتح لك صفحة Appllama، وافق، وهترجع للمنصة متوصّل (OAuth). الـ redirect بيرجع على `PUBLIC_URL`، فلازم يكون متظبط صح في `.env`.
2. افتح **/market**، دوّر بوصف التطبيق (مثلًا "habit tracker") وفلتر بالإيراد أو التقييم أو الأسعار، واضغط **Save** على التطبيقات اللي عايز تدرسها بس.
3. الحفظ بيشتغل في الـ worker: بيحفظ البروفايل وكل الشاشات كصور WebP على السيرفر عندك (لينكات الصور عند Appllama بتنتهي بعد حوالي ساعة). لو التطبيق مش في الـ library بيتضاف تلقائي على iOS.
4. في صفحة التطبيق هتلاقي تابين: **Market** (إيراد، تحميلات، تقييم، ترتيب، الـ IAP، الدول واللغات) و**Market screens** (الشاشات مقسّمة: welcome، onboarding، paywall، داخل التطبيق، مع الألوان وعناصر الواجهة). صفحة الفرصة بتعرض المنافسين وأسعارهم، والـ spec بياخد السعر من أقرب منافس.

الكريدت: أي نداء لـ Appllama بيخصم 1 كريدت، وحفظ تطبيق بيكلف حوالي `1 + عدد الشاشات / 10`. الحدود على Pro: 90 في الدقيقة، 400 في اليوم، 1500 في الشهر، والمنصة بتقف عند 390 في اليوم. لو التقدير فوق 15 كريدت بيطلب منك تأكيد. **ممنوع الـ harvesting**: شروط Appllama بتمنع سحب الكتالوج كله، فاحفظ تطبيقات محددة بتدرسها بس. الصور عليها watermark وللمرجع فقط. الـ MCP فيه 3 أدوات: `market_search` و`market_save` و`get_market`.

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

**Model.** An opportunity is one recurring missing capability ("Offline mode — sleep stories"). The `group_labels` job takes every distinct `lower(trim(label))` of complaint/request reviews and imported items that is not yet in `opportunity_labels`, and asks the model (batches of 120) to map each onto an existing opportunity or to form new ones. Embeddings are optional (see Embeddings below). Canonical labels are `<missing capability> — <context>`, at most 60 characters, without app names. A label the model skips becomes an opportunity of its own; replies that are not valid JSON fall back to one opportunity per label. Evidence is the union of reviews and items joined through `opportunity_labels`. Merging two opportunities moves all labels onto one.

**Score.** `recent × (1 + listingWeight × (listings − 1)) × (1 + painWeight × avg_pain / 5) × (1 + wtpWeight × wtp_share)` with the defaults 0.5, 1 and 2 (see Scoring weights below). `recent` is the evidence count weighted by a half-life of `halfLifeDays` (90 by default) (undated evidence counts as 180 days old). `listings` is the number of distinct `(store, store_id)` pairs with evidence (minimum 1), so one app tracked in five countries counts once. `avg_pain` is the mean pain score 0–5. `wtp_share` is the share of evidence whose signal is `paying_competitor`, `churned`, `workaround` or `stated_wtp`. The same formula lives in SQL (`statsSelect`) and in `opportunityScore()`. Lists exclude your own apps by default (`own`: `exclude`, `only`, `all`) and hide opportunities without evidence in the chosen view.

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

**Jobs.** `group_labels` maps new labels (queued after a review analysis or item analysis classifies anything, from the opportunities page, and nightly after `sync_all` on the sync cron); `generate_spec` (payload `opportunityId`) is queued by the Generate spec button; `analyse_items` runs after an import; `analyse_all` re-analyses apps classified by an older `ANALYSIS_VERSION`; `fetch_reddit` pulls Reddit posts; `generate_validation` (payload `opportunityId`) writes the validation kit; `embed_labels` embeds labels and refreshes centroids. Every night the sync cron queues `sync_all`, then `fetch_reddit` (when Reddit is enabled), `group_labels`, and `embed_labels` (when embeddings are configured). `pollBatches` runs on the worker's 60-second interval. The MCP server never calls the model itself, it only enqueues these jobs.

#### Providers

`chat()` in `packages/core/src/ai.ts` dispatches on `settings.ai.provider`: `openai` (default) is any OpenAI-compatible `/chat/completions` endpoint (OpenRouter, Ollama, vLLM); `anthropic` uses the Anthropic Messages API with the configured key and model. The system prompt is marked cacheable, but Haiku 4.5 needs a prefix of at least 4096 tokens before caching applies, while Sonnet 5.5 and Opus 5.5 need only 512, so caching mostly helps the larger models.

**Batches.** With `provider = anthropic` and **Use Message Batches** on, classification is asynchronous and about 50% cheaper. `analyseApp` (and item analysis) calls `submitClassificationBatch`, which sends every unclassified row (20 per request, same prompt as the synchronous path) to the Message Batches API and records the batch in `ai_batches` (`provider_batch_id`, `kind` reviews or items, `app_id`, `status` submitted, ended or failed, `payload` mapping each `custom_id` to its row ids). Nothing is submitted while a batch for the same target is still open. The worker calls `pollBatches` every 60 seconds. When a batch has ended, results are applied (evidence quotes re-checked against the stored text), the row is marked `ended` (or `failed` if every request errored), `group_labels` is queued and, for a reviews batch, the app summary is written. Rows the provider could not answer stay unclassified and are retried by the next run.

#### Embeddings

Optional. **Settings → Embeddings** takes any OpenAI-shaped `/embeddings` endpoint (Voyage `https://api.voyageai.com/v1`, OpenAI `https://api.openai.com/v1`); dimensions must be 1024 because the column is `vector(1024)`. Vectors are stored per label in `label_embeddings`, and each opportunity has a `centroid` (mean of its labels). During `group_labels`, an unmapped label whose cosine similarity to an opportunity centroid is at least `autoMapThreshold` (default 0.86) is mapped without asking the model; the rest still go to the model. Because killed opportunities have centroids too, a label that resembles a killed idea maps onto it and stays hidden. `similar_opportunities` (and the Similar list on an opportunity) returns the nearest centroids. The `embed_labels` job embeds new labels and refreshes centroids. Migration 0006 creates the pgvector objects only when the extension is available (guarded by `pg_available_extensions`); without pgvector, or with no embedding base URL, everything else works and similar lists are empty.

#### Scoring weights

`recent × (1 + listingWeight × (listings − 1)) × (1 + painWeight × avg_pain / 5) × (1 + wtpWeight × wtp_share)`. Settings (`settings.score`) and defaults: `listingWeight` 0.5, `painWeight` 1, `wtpWeight` 2, `halfLifeDays` 90 (used in `recent`), `autoMapThreshold` 0.86 (embeddings only). Non-numeric values fall back to the defaults. The formula is in `statsSelect` (SQL) and `opportunityScore()`, both fed from the same settings.

#### Label review

`/review` shows classified reviews and items without a verdict (analysed by the current analyser; rows with a willingness-to-pay signal first, then random). A verdict is `correct` or `wrong` (`review_verdicts`, one per row, recording again replaces it); for `wrong` you can correct `wtp_signal`, `label_kind`, `pain_score` or `label`, and the correction is written through to the review or item row so it changes scores everywhere. Refs are `<app_id>:<review_id>` for reviews and the item id for items. Accuracy is `correct / total`, overall and by analyser version, signal and kind. Buckets use what the model originally returned (`raw_analysis`), so a correction never moves a verdict to another bucket. Aim for about 200 verdicts before trusting the number.

#### Validation kit

`generate_validation` (queued from the Validation tab) has the model write a fake-door kit from the top evidence: headline, bullets, cta, price, a reply for the thread where the pain lives and waitlist copy, stored in `opportunities.validation`. Results go into `validation_metrics`: `waitlist`, `price_clicks`, `replies`, `started_at` and `recorded_at`. Decision rule (`validationDecision`):

- proceed when waitlist ≥ 20 or price clicks ≥ 5 or replies ≥ 3
- kill when none of those and started ≥ 5 days ago
- else pending

#### Reddit source

**Settings → Reddit**: `enabled`, `clientId`, `clientSecret`, `userAgent`, `subreddits`, `keywords` and `limit` (posts per search, default 50). Create a **script** app at reddit.com/prefs/apps for the credentials. `fetch_reddit` gets an app-only token, searches each subreddit for each keyword, and imports posts as items with source `reddit` (deduplicated like any import), then queues `analyse_items`. Requests are paced at one per 700 ms and identify themselves with your User-Agent. Policy: the Reddit Data API is for personal, non-commercial use unless Reddit approves otherwise; do not raise the rate or add parallelism.

#### Outcomes view

`/opportunities?view=outcomes` lists shipped and killed opportunities with status, score, gate result, validation decision, installs, trial starts and paying customers.

### Login

The web UI sits behind a single-user login (the MCP server keeps its bearer token). On first run every page redirects to `/setup`, where you choose the password (8+ characters); after that `/login` asks for it. Sessions are signed `lens_session` cookies (HMAC-SHA256 with `SESSION_SECRET`, httpOnly, `SameSite=Lax`, `Secure` when `PUBLIC_URL` is https): 12 hours, or 30 days with "Remember me". The web app refuses requests while `SESSION_SECRET` is missing or shorter than 32 characters.

The password and PIN hashes (scrypt) live in the `auth` settings key and never reach the browser. Changing the password bumps `passwordSetAt`, which signs every other session out. **Settings → Security** also enables a 6-digit PIN per device (`lens_device` cookie, 180 days): `/login` then shows the PIN form first. Five wrong PINs delete that device's PIN. Five wrong passwords lock the login for 1 minute, doubling per further failure up to 15 minutes. `/api/health` stays open; `/media/*` and other API routes answer 401 without a session. Cloudflare Access is still recommended as an outer layer.

### Market (Appllama)

Connect once from Settings → Appllama (OAuth with dynamic client registration and PKCE; no API key). The callback is `${PUBLIC_URL}/api/appllama/callback`, so `PUBLIC_URL` must be reachable from your browser. Tokens stay on the server; the UI only shows "Connected since" and your credit balance.

`/market` searches Appllama (`search_apps`) with filters and shows **Saved** and **In library** badges. **Save** queues a `market_save` job that stores the profile (revenue, downloads, IAP prices, rank, flows) and every screen as local WebP (Appllama media URLs expire in about an hour). A saved app that is not in the library is added as iOS with `store_id` = the Appllama app id, so reviews and market data share one record. The app page gains **Market** and **Market screens** tabs; opportunities show competitor revenue and price, feed the spec and validation prompts, and give the gate's Demand row an auto-check. **Import a board** saves up to 20 apps from an Appllama apps board.

Credits: every call costs 1; a save costs about `1 + screens / 10` (confirmation above 15). Pro limits are 90/min, 400/day and 1,500/month; the client paces itself and refuses at 390 calls a day. Appllama's terms forbid harvesting the catalogue: save apps you study, do not sweep it. Media is watermarked and for reference only. MCP tools: `market_search`, `market_save`, `get_market`.

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
| `record_verdict`                                            | Mark a classified review/item correct or wrong       |
| `get_accuracy`                                              | Classifier accuracy from recorded verdicts           |
| `get_review_queue`                                          | Classified rows with no verdict yet                  |
| `get_validation`                                            | Validation kit, metrics and decision                 |
| `save_validation_metrics`                                   | Save fake-door results; returns the decision         |
| `similar_opportunities`                                     | Nearest opportunities by embeddings                  |
| `market_search`                                             | Search Appllama (needs Connect; marks saved apps)    |
| `market_save`                                               | Queue saving an Appllama app and its screens         |
| `get_market`                                                | Saved market profile and screens of a library app    |

### Development

Requires Node 22 and pnpm 10.

```bash
pnpm install
docker run -d --name lens-pg -e POSTGRES_PASSWORD=lens -e POSTGRES_DB=lens -p 5433:5432 pgvector/pgvector:pg16
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

| Variable                      | Used by       | Notes                                                                                                          |
| ----------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                | all           | Postgres URL. SSL is required automatically for non-local hosts (`DATABASE_SSL=disable\|require` to override). |
| `MEDIA_DIR`                   | all           | Set to `/data/media` in the containers                                                                         |
| `PUBLIC_URL`                  | mcp           | Base for absolute image links returned by MCP tools                                                            |
| `PUBLIC_MCP_URL`, `MCP_TOKEN` | web, mcp      | Shown on the Settings page; `MCP_TOKEN` must be at least 24 characters                                         |
| `TZ`                          | worker, web   | Time zone for the cron schedule                                                                                |
| `SESSION_SECRET`              | web           | Required. At least 32 characters (`openssl rand -hex 32`); signs the login cookies                             |
| `CLOUDFLARE_TUNNEL_TOKEN`     | cloudflared   | Only with `--profile tunnel`                                                                                   |
| `DATABASE_BACKUP_URL`         | backup script | Session-pooler URL for `pg_dump`                                                                               |
| `DATABASE_POOL_SIZE`          | all           | Connections per process (default 10)                                                                           |
| `WORKER_CONCURRENCY`          | worker        | Jobs run at once (default 2)                                                                                   |
| `WORKER_JOB_TIMEOUT_MS`       | worker        | A job running longer is failed and retried (default 15 min)                                                    |

### Using a local database instead of Supabase

Set `DATABASE_URL=postgres://lens:lens@db:5432/lens` and start with `docker compose --profile localdb up -d --build`. Data lives in `data/postgres`.
