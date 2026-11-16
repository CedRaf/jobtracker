-- Starred jobs: your own highlight for listings you want to come back to
-- (e.g. one you found before you're ready to apply). Separate from `flags`,
-- which the scraper writes from the description.
--
--   * starred_at: when you starred the job; null = not starred. Set and
--     cleared from the dashboard, never by the scraper (its upserts only send
--     the columns it owns).
--   * A starred job isn't expired for sitting in New (expire_stale_jobs), since
--     keeping it there is the point. A listing the scraper finds taken down
--     still expires: it's gone either way.

alter table public.jobs add column starred_at timestamptz;

create index jobs_starred_idx on public.jobs (starred_at desc) where starred_at is not null;

grant update (starred_at) on public.jobs to authenticated;

-- As in 20261112000002_job_expiry_start.sql, plus "and starred_at is null".
create or replace function public.expire_stale_jobs(p_days integer default 15)
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
    where status = 'new'
      and starred_at is null
      and coalesce(status_changed_at, first_seen) < now() - make_interval(days => p_days)
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
