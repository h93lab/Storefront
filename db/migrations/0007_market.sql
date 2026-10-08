-- H93 Market (Appllama): saved market profiles and journey screens. DDL only.
create table if not exists app_market (
  app_id uuid primary key references apps(id) on delete cascade,
  appllama_id text not null unique,
  profile jsonb not null,                 -- the get_app payload (minus hint/credits)
  revenue_monthly_usd numeric,
  downloads numeric,
  rating numeric, ratings_count bigint,
  category_rank int, category text,
  launched date, last_updated date,
  screens_count int, videos_count int,
  screens_synced int not null default 0,  -- how many screens are stored locally
  screens_cursor text,                    -- resume point when a save was interrupted
  fetched_at timestamptz not null default now(),
  screens_fetched_at timestamptz,
  credits_spent int not null default 0
);
create table if not exists app_screens (
  id bigserial primary key,
  app_id uuid not null references apps(id) on delete cascade,
  screen_id text not null,
  name text, flow text, section text, position int,
  kind text not null default 'image',
  path text,                              -- stored WebP relative to MEDIA_DIR (null for videos / failed downloads)
  width int, height int, duration_ms int,
  dominant_color text, colors text[] not null default '{}', ui_elements text[] not null default '{}',
  fetched_at timestamptz not null default now(),
  unique (app_id, screen_id)
);
create index if not exists app_screens_app on app_screens (app_id, section, position);
alter table app_market enable row level security;
alter table app_screens enable row level security;
