-- The listing lifecycle (docs/STATE_MACHINE_PLAN.md, rollout 2, "Machine 3").
--
-- Before this, whether the scraper had already handled a listing lived only in
-- a JSON file in the GitHub Actions cache. When an entry aged out or the cache
-- was evicted, an old listing was judged again under today's rules and could
-- land in both jobs and filtered_jobs. Now:
--
--   * The database is the seen list (plan 3.0, option A): each run loads every
--     key in jobs, filtered_jobs and expired_listings for its site, and the
--     repost keys in jobs. The cache file is only a fallback without credentials.
--   * expired_listings records listings that had already closed when first
--     seen (they used to live only in the cache file).
--   * A listing is in jobs or in filtered_jobs, never both (plan 3.1): an
--     insert of a key the other table has is skipped, like a duplicate.
--   * Closed postings expire (plan 3.2, as the Expired status): each run
--     re-checks its site's New jobs aged 3 to 15 days and expires the ones
--     whose posting has closed. Like the 15-day expiry, only jobs found (or
--     back in New) after rollout 1 count, so the older backlog is left alone.
--
-- Existing rows are left as they are, including any listing already in both
-- tables (see docs/ARCHITECTURE.md for a query that lists them).

-- ===== Listings that were already closed ====================================

create table public.expired_listings (
  source       public.job_source not null,
  external_id  text not null,
  first_seen   timestamptz not null default now(),
  primary key (source, external_id)
);

alter table public.expired_listings enable row level security;
revoke all on public.expired_listings from anon, authenticated;
grant all on public.expired_listings to service_role;

-- ===== One table per listing ================================================

-- Skips (returns null for) an insert whose key the other table already has, so
-- the scraper's batch inserts go on with the rest, as with a duplicate key.
create function public.listing_in_one_table()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if tg_table_name = 'jobs' then
    if exists (select 1 from public.filtered_jobs f
               where f.source = new.source and f.external_id = new.external_id) then
      return null;
    end if;
  elsif exists (select 1 from public.jobs j
                where j.source = new.source and j.external_id = new.external_id) then
    return null;
  end if;
  return new;
end
$fn$;

-- Named to run before jobs_track_application (triggers fire in name order).
create trigger jobs_listing_in_one_table
  before insert on public.jobs
  for each row when (new.source <> 'manual')
  execute function public.listing_in_one_table();

create trigger filtered_jobs_listing_in_one_table
  before insert on public.filtered_jobs
  for each row execute function public.listing_in_one_table();

-- ===== Closed postings =======================================================

-- The site's jobs still in New whose time in New started p_min_days to p_max_days
-- ago, after expiry started (job_expiry_start), oldest first: the ones worth
-- asking the site about. Older ones expire by age anyway.
create function public.jobs_to_recheck(
  p_source public.job_source,
  p_min_days integer default 3,
  p_max_days integer default 15)
returns setof text
language sql
stable
security definer
set search_path = ''
as $fn$
  select j.external_id
  from public.jobs j
  where j.source = p_source
    and j.status = 'new'
    and coalesce(j.status_changed_at, j.first_seen) <= now() - make_interval(days => p_min_days)
    and coalesce(j.status_changed_at, j.first_seen) > now() - make_interval(days => p_max_days)
    and coalesce(j.status_changed_at, j.first_seen) >= (select since from public.job_expiry_start)
  order by coalesce(j.status_changed_at, j.first_seen)
$fn$;

-- Moves the site's jobs whose posting has closed from New to Expired (a
-- system-only move, logged as an expiry). Jobs no longer in New, or in New
-- since before expiry started, are left alone. Returns how many moved.
create function public.expire_closed_jobs(p_source public.job_source, p_external_ids text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  j public.jobs;
  saved public.jobs;
  expired integer := 0;
begin
  perform set_config('jobtracker.status_change', 'on', true);
  for j in
    select * from public.jobs
    where source = p_source
      and external_id = any (p_external_ids)
      and status = 'new'
      and coalesce(status_changed_at, first_seen) >= (select since from public.job_expiry_start)
    for update skip locked
  loop
    update public.jobs set status = 'expired'
    where source = j.source and external_id = j.external_id
    returning * into saved;

    insert into public.status_history
      (job_source, job_external_id, from_status, to_status, changed_by, kind, before, after)
    values (j.source, j.external_id, 'new', 'expired', null, 'expiry',
            public.job_status_snapshot(j), public.job_status_snapshot(saved));
    expired := expired + 1;
  end loop;
  perform set_config('jobtracker.status_change', '', true);
  return expired;
end
$fn$;

-- Only the scraper (the service role) calls these.
revoke execute on function
  public.jobs_to_recheck(public.job_source, integer, integer),
  public.expire_closed_jobs(public.job_source, text[])
  from public, anon, authenticated;
grant execute on function
  public.jobs_to_recheck(public.job_source, integer, integer),
  public.expire_closed_jobs(public.job_source, text[])
  to service_role;
