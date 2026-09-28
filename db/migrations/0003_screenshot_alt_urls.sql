-- Other URLs the same image was listed under, so it is not downloaded again.
alter table screenshots add column if not exists alt_urls text[] not null default '{}';
