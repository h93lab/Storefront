-- H93 round 2: embeddings (optional), label verdicts, Message Batches, validation kit. DDL only.

-- pgvector is optional: everything below still works without it, embeddings just stay disabled.
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'vector') then
    execute 'create extension if not exists vector';
    execute 'create table if not exists label_embeddings (label text primary key, model text not null, v vector(1024) not null, created_at timestamptz not null default now())';
    execute 'alter table opportunities add column if not exists centroid vector(1024)';
    execute 'create index if not exists opportunities_centroid on opportunities using hnsw (centroid vector_cosine_ops)';
  end if;
end $$;

-- ground truth for the classifier
create table if not exists review_verdicts (
  id bigserial primary key,
  source text not null check (source in ('review','item')),
  ref text not null,                       -- review: '<app_id>:<review_id>', item: '<id>' (same as Evidence.ref)
  verdict text not null check (verdict in ('correct','wrong')),
  corrected jsonb,                         -- {"wtp_signal":"...","label_kind":"...","pain_score":3,"label":"..."} any subset
  notes text,
  analysis_version smallint not null,
  created_at timestamptz not null default now(),
  unique (source, ref)
);

-- Anthropic Message Batches in flight
create table if not exists ai_batches (
  id bigserial primary key,
  provider_batch_id text not null unique,
  kind text not null check (kind in ('reviews','items')),
  app_id uuid references apps(id) on delete cascade,
  status text not null default 'submitted' check (status in ('submitted','ended','failed')),
  request_count int not null default 0,
  payload jsonb not null,                  -- {"requests":[{"custom_id":"...","ids":["review_id",...]}]}
  error text,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists ai_batches_open on ai_batches (status) where status = 'submitted';

alter table opportunities
  add column if not exists validation jsonb,          -- generated kit, see generateValidation
  add column if not exists validation_metrics jsonb;  -- {"waitlist":0,"price_clicks":0,"replies":0,"started_at":"...","recorded_at":"..."}

-- RLS like the others
alter table review_verdicts enable row level security;
alter table ai_batches enable row level security;
do $$ begin if to_regclass('label_embeddings') is not null then execute 'alter table label_embeddings enable row level security'; end if; end $$;
