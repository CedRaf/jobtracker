-- Application tracking: how you applied to each job, so the dashboard can
-- show which strategies get responses.
--
-- Per job (all editable on the dashboard):
--   * channel, resume_version, role_type, work_setup: what you did. 'unknown'
--     where nobody has said yet.
--   * applied_at, first_response_at: when. Days to a response is derived from
--     these two, never stored.
--
-- The outcome (no reply / rejected / exam / interview / offer) is NOT stored:
-- it's derived from the board status and its history (web/src/lib/analytics.ts
-- deriveOutcome), so it can't drift from the kanban.
--
-- Applications you log yourself use source = 'manual' (previous migration);
-- the dashboard may insert those, and only those.

-- ===== Types ================================================================

create type public.application_channel as enum (
  'unknown', 'job_board', 'direct_message', 'referral', 'company_site', 'other'
);

create type public.role_type as enum ('unknown', 'web', 'ai', 'other');

create type public.work_setup as enum (
  'unknown', 'cebu_onsite', 'manila_onsite', 'remote', 'hybrid'
);

-- Resume variants are rows, not an enum, so you can add one from the dashboard
-- without a migration. 'unknown' is the default for jobs nobody has set.
create table public.resume_versions (
  key         text primary key check (key ~ '^[a-z0-9_]{1,32}$'),
  label       text not null check (length(btrim(label)) between 1 and 60),
  created_at  timestamptz not null default now()
);

insert into public.resume_versions (key, label) values
  ('unknown', 'Unknown'),
  ('web', 'Web'),
  ('ai', 'AI');

-- ===== Columns ==============================================================

alter table public.jobs
  add column channel            public.application_channel not null default 'unknown',
  add column resume_version     text not null default 'unknown'
                                  references public.resume_versions (key),
  add column role_type          public.role_type not null default 'unknown',
  add column work_setup         public.work_setup not null default 'unknown',
  add column applied_at         timestamptz,
  add column first_response_at  timestamptz;

-- ===== Helpers ==============================================================

-- The work setup a listing's arrangements and location suggest, or 'unknown'
-- when they don't say or disagree (e.g. "Remote" and "On-site" both listed).
create function public.guess_work_setup(arrangements text[], location text)
returns public.work_setup
language sql
immutable
set search_path = ''
as $fn$
  with a as (
    select coalesce(array_agg(distinct lower(x)), '{}') as kinds
    from unnest(arrangements) as x
  )
  select case
    when kinds = array['remote'] then 'remote'
    when 'hybrid' = any (kinds) and not 'remote' = any (kinds) then 'hybrid'
    when kinds = array['on-site'] and location ~* 'cebu' then 'cebu_onsite'
    when kinds = array['on-site']
         and location ~* '(manila|makati|taguig|pasig|quezon city|mandaluyong|ortigas|bgc|pasay|para[nñ]aque|muntinlupa|alabang|san juan)'
      then 'manila_onsite'
    else 'unknown'
  end::public.work_setup
  from a
$fn$;

-- ===== Backfill existing jobs ===============================================
-- applied_at: the first applied/emailed change; failing that, the first
-- change to a later stage (they imply an application); failing that (jobs
-- imported from the Sheet have no history), when an applied/emailed job got
-- its status, or when its email was drafted.
-- first_response_at: the first exam/interview/offer/rejected change after
-- applied_at. Never guessed for imported jobs.
-- channel: Emailed means you emailed the company; Applied means you used the
-- job board. Everything else stays 'unknown'.

with applied as (
  select job_source, job_external_id,
         coalesce(
           min(changed_at) filter (where to_status in ('applied', 'emailed')),
           min(changed_at) filter (where to_status in ('exam', 'interview', 'offer', 'rejected'))
         ) as at,
         bool_or(to_status = 'emailed') as emailed
  from public.status_history
  group by job_source, job_external_id
)
update public.jobs j
set applied_at = coalesce(
      a.at,
      case when j.status in ('applied', 'emailed')
           then coalesce(j.status_changed_at, j.email_drafted_at) end),
    channel = case
      when coalesce(a.emailed, false) or j.status = 'emailed' or j.email_drafted_at is not null
        then 'direct_message'
      when a.at is not null or j.status in ('applied', 'interview', 'offer', 'rejected')
        then 'job_board'
      else 'unknown'
    end::public.application_channel
from public.jobs j2
left join applied a on a.job_source = j2.source and a.job_external_id = j2.external_id
where j2.source = j.source and j2.external_id = j.external_id;

update public.jobs j
set first_response_at = (
  select min(h.changed_at)
  from public.status_history h
  where h.job_source = j.source and h.job_external_id = j.external_id
    and h.to_status in ('exam', 'interview', 'offer', 'rejected')
    and h.changed_at > j.applied_at
)
where j.applied_at is not null;

update public.jobs
set work_setup = public.guess_work_setup(work_arrangements, location);

-- Only now: the backfill above can't break it, and the dashboard checks it too.
alter table public.jobs
  add constraint jobs_response_after_applied
  check (first_response_at is null or applied_at is null or first_response_at >= applied_at);

-- ===== Triggers =============================================================

-- Fills in what the status change tells us, never overwriting a value you set:
--   * on insert, the work setup from the listing;
--   * the first move to an applied-or-later stage sets applied_at (and the
--     channel, as in the backfill, for scraped jobs);
--   * the first move to a response stage after that sets first_response_at.
--     Jumping straight from New to Rejected sets only applied_at, so it
--     doesn't count as a same-day response.
create function public.jobs_track_application()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  was_applied boolean := tg_op = 'UPDATE' and old.applied_at is not null;
begin
  if tg_op = 'INSERT' and new.work_setup = 'unknown' then
    new.work_setup := public.guess_work_setup(new.work_arrangements, new.location);
  end if;

  if new.status in ('applied', 'emailed', 'exam', 'interview', 'offer', 'rejected') then
    if new.applied_at is null then
      new.applied_at := now();
    end if;
    if new.channel = 'unknown' and new.source <> 'manual' then
      new.channel := case when new.status = 'emailed' then 'direct_message' else 'job_board' end;
    end if;
  end if;

  if new.status in ('exam', 'interview', 'offer', 'rejected')
     and new.first_response_at is null and was_applied then
    new.first_response_at := greatest(now(), new.applied_at);
  end if;

  return new;
end
$fn$;

create trigger jobs_track_application
  before insert or update of status on public.jobs
  for each row execute function public.jobs_track_application();

-- A logged application starts at its stage (usually Applied): record that as
-- its first status change, as the update trigger would have.
create function public.jobs_log_initial_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.status_history (job_source, job_external_id, from_status, to_status, changed_at)
  values (new.source, new.external_id, null, new.status, coalesce(new.applied_at, now()));
  return null;
end
$fn$;

create trigger jobs_log_initial_status
  after insert on public.jobs
  for each row
  when (new.status <> 'new')
  execute function public.jobs_log_initial_status();

-- ===== Row-level security and grants =======================================

alter table public.resume_versions enable row level security;

create policy "app users read resume versions" on public.resume_versions
  for select to authenticated using ((select public.is_app_user()));

create policy "app users add resume versions" on public.resume_versions
  for insert to authenticated with check ((select public.is_app_user()));

-- Only manual applications: scraped jobs come from the scraper alone.
create policy "app users log manual applications" on public.jobs
  for insert to authenticated
  with check ((select public.is_app_user()) and source = 'manual');

revoke all on public.resume_versions from anon, authenticated;
grant select on public.resume_versions to authenticated;
grant insert (key, label) on public.resume_versions to authenticated;
grant all on public.resume_versions to service_role;

grant update (channel, resume_version, role_type, work_setup, applied_at, first_response_at)
  on public.jobs to authenticated;

grant insert (source, external_id, title, company, location, work_arrangements, url, status, notes,
              channel, resume_version, role_type, work_setup, applied_at, first_response_at)
  on public.jobs to authenticated;

revoke execute on function public.guess_work_setup(text[], text) from public, anon;
grant execute on function public.guess_work_setup(text[], text) to authenticated, service_role;
