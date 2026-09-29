-- Opportunities (H93): recurring missing capabilities grouped from review labels, plus imported text items.
-- DDL only.
alter table apps add column if not exists own boolean not null default false;   -- the user's own shipped app

create table if not exists opportunities (
  id bigserial primary key,
  label text not null,                        -- canonical English label "<missing capability> — <context>"
  kind text not null default 'complaint' check (kind in ('complaint', 'request')),
  status text not null default 'surfaced' check (status in ('surfaced', 'validating', 'building', 'shipped', 'killed')),
  notes text,
  gate jsonb,                                 -- {"checks":{"scope":true,...},"notes":"...","checked_at":"..."}
  spec_md text,
  spec_generated_at timestamptz,
  outcome jsonb,                              -- {"installs":0,"trial_starts":0,"paying":0,"notes":"","recorded_at":"..."}
  killed_reason text,
  revisit_after timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists opportunities_status on opportunities (status, updated_at desc);

-- every distinct lowercased review label maps to exactly one opportunity
create table if not exists opportunity_labels (
  label text primary key,                     -- lower(trim(label))
  opportunity_id bigint not null references opportunities(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists opportunity_labels_opp on opportunity_labels (opportunity_id);

-- text from outside the stores: pasted posts, support emails, forum threads
create table if not exists items (
  id bigserial primary key,
  source text not null default 'paste',       -- paste | reddit | support | other
  url text,
  author text,
  body text not null,
  app_id uuid references apps(id) on delete set null,
  posted_at timestamptz,
  fetched_at timestamptz not null default now(),
  content_hash text not null,                 -- md5(lower(regexp_replace(body,'\s+',' ','g')))
  sentiment text, topic text, label text, label_kind text,
  wtp_signal text, competitor_mentioned text, workaround text, evidence_span text, pain_score smallint,
  raw_analysis jsonb, analysis_version smallint not null default 0, analysed_at timestamptz,
  unique (source, content_hash)
);
create index if not exists items_pending on items (analysed_at) where analysed_at is null;

create index if not exists reviews_label on reviews (lower(trim(label))) where label is not null;
create index if not exists items_label on items (lower(trim(label))) where label is not null;

alter table opportunities enable row level security;
alter table opportunity_labels enable row level security;
alter table items enable row level security;
