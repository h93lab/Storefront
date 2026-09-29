-- Opportunity signals extracted from each review by the AI pass (H93 phase 1).
-- DDL only: existing rows are re-analysed by the `analyse_all` job, not here.
alter table reviews
  add column if not exists analysis_version smallint not null default 0,
  add column if not exists pain_score smallint check (pain_score between 0 and 5),
  add column if not exists wtp_signal text check (wtp_signal in ('paying_competitor', 'churned', 'workaround', 'stated_wtp', 'none')),
  add column if not exists competitor_mentioned text,
  add column if not exists workaround text,
  add column if not exists evidence_span text,          -- verbatim quote from the review that supports the label
  add column if not exists raw_analysis jsonb;          -- the model's item as returned, for re-processing
create index if not exists reviews_signal on reviews (wtp_signal) where wtp_signal <> 'none';
