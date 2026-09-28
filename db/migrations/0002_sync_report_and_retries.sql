-- Live job progress, delayed retries, and a per-app report of the last sync.
alter table jobs add column if not exists progress text;
alter table jobs add column if not exists run_after timestamptz not null default now();
create index if not exists jobs_ready on jobs (status, run_after, id);

alter table apps add column if not exists sync_report jsonb;
