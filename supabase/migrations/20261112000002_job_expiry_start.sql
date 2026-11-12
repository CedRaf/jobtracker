-- Expiry only for jobs found after rollout 1 (docs/STATE_MACHINE_PLAN.md, 1.9:
-- existing data is left alone).
--
-- 20261112000001_job_status_machine.sql shipped expire_stale_jobs() expiring
-- every job left in New for 15 days, the older backlog included. This keeps
-- the backlog in New: only jobs found, or brought back to New, after rollout 1
-- ran expire. (It's a migration of its own because 20261112000001 had already
-- been applied: an applied migration is never run again, so editing it
-- changes nothing.)

-- When expiry started. Postgres doesn't record when a migration ran, so this
-- uses the first status change rollout 1's functions wrote (those carry a
-- snapshot), else now: close to when 20261112000001 ran, and never before it.
create table public.job_expiry_start (
  since timestamptz not null,
  single boolean primary key default true check (single)
);

insert into public.job_expiry_start (since)
select coalesce(min(changed_at), now())
from public.status_history
where before is not null;

-- Same as before, plus the cutoff.
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

-- Only the database reads it.
alter table public.job_expiry_start enable row level security;
revoke all on public.job_expiry_start from anon, authenticated;
grant all on public.job_expiry_start to service_role;
