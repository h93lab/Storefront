-- Storefront Lens schema. Applied automatically by the worker on startup
-- (see packages/core/src/migrate.ts), or manually in the Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists apps (
  id uuid primary key default gen_random_uuid(),
  store text not null check (store in ('ios', 'android')),
  store_id text not null,                -- iOS numeric track id / Android package name
  country text not null default 'us',    -- two-letter storefront code, lowercase
  lang text not null default 'en',       -- review/listing language (Google Play filters by it)
  name text not null default '',
  developer text,
  category text,
  description text,
  release_notes text,
  price text,
  price_value numeric,
  currency text,
  rating numeric,
  ratings_count bigint,
  version text,
  updated_at_store timestamptz,
  size_bytes bigint,
  content_rating text,
  store_url text,
  icon_path text,
  status text not null default 'pending' check (status in ('pending', 'syncing', 'ready', 'error')),
  last_error text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (store, store_id, country)
);

create table if not exists screenshots (
  id bigserial primary key,
  app_id uuid not null references apps(id) on delete cascade,
  hash text not null,                    -- sha256 of the original image bytes
  path text not null,                    -- relative to MEDIA_DIR
  source_url text not null,
  width int,
  height int,
  position int not null default 0,
  device text not null default 'phone',
  active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (app_id, hash)
);
create index if not exists screenshots_app_active on screenshots (app_id, active, position);

create table if not exists reviews (
  app_id uuid not null references apps(id) on delete cascade,
  review_id text not null,
  author text,
  rating int,
  title text,
  body text,
  app_version text,
  reviewed_at timestamptz,
  fetched_at timestamptz not null default now(),
  sentiment text check (sentiment in ('positive', 'neutral', 'negative')),
  topic text,
  label text,                            -- short complaint / request label from the AI pass
  label_kind text check (label_kind in ('complaint', 'request', 'praise', 'other')),
  analysed_at timestamptz,
  primary key (app_id, review_id)
);
create index if not exists reviews_app_date on reviews (app_id, reviewed_at desc);

create table if not exists snapshots (
  id bigserial primary key,
  app_id uuid not null references apps(id) on delete cascade,
  taken_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists snapshots_app_time on snapshots (app_id, taken_at desc);

create table if not exists changes (
  id bigserial primary key,
  app_id uuid not null references apps(id) on delete cascade,
  detected_at timestamptz not null default now(),
  field text not null,                   -- screenshots | description | price | version | name | icon | release_notes
  old_value jsonb,
  new_value jsonb,
  summary text
);
create index if not exists changes_time on changes (detected_at desc);

create table if not exists rating_history (
  app_id uuid not null references apps(id) on delete cascade,
  day date not null,
  rating numeric,
  ratings_count bigint,
  primary key (app_id, day)
);

create table if not exists insights (
  app_id uuid primary key references apps(id) on delete cascade,
  generated_at timestamptz not null default now(),
  model text,
  reviews_count int,
  sentiment jsonb,                       -- {positive, neutral, negative} as counts
  complaints jsonb,                      -- [{label, count}]
  requests jsonb,                        -- [{label, count}]
  summary text
);

create table if not exists boards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists board_items (
  id bigserial primary key,
  board_id uuid not null references boards(id) on delete cascade,
  kind text not null check (kind in ('screenshot', 'review')),
  app_id uuid not null references apps(id) on delete cascade,
  screenshot_id bigint references screenshots(id) on delete cascade,
  review_id text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists board_items_board on board_items (board_id, created_at desc);

create table if not exists jobs (
  id bigserial primary key,
  type text not null,                    -- sync_app | sync_all | analyse_app
  payload jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  result text,
  error text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists jobs_queue on jobs (status, id);

create table if not exists settings (
  key text primary key,
  value jsonb not null
);

-- Supabase exposes tables in `public` over its REST API. This app only talks to
-- Postgres directly, so lock the tables down for the anon/authenticated roles.
do $$
declare t text;
begin
  foreach t in array array['apps','screenshots','reviews','snapshots','changes','rating_history','insights','boards','board_items','jobs','settings'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
