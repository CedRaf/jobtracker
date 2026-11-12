-- The job status as an explicit state machine (docs/STATE_MACHINE_PLAN.md,
-- rollout 1, "Machine 1: Job application").
--
-- Before this, any status could be set to any other with a plain UPDATE, and
-- triggers filled in the application fields after the fact without ever
-- clearing them. Now:
--
--   * job_status_transitions lists every allowed move (web/src/lib/transitions.ts
--     keeps a copy for the UI; a test checks the two match).
--   * change_job_status() is the only way to move a job: it checks the move,
--     updates the related fields in the same statement and writes history with
--     a snapshot of the fields before and after.
--   * revert_status_change() undoes a job's latest change exactly, from that
--     snapshot, and marks the history row reverted (the analytics skip it).
--   * correct_job_status() fixes a decision later: any status, logged as a
--     correction that replaces the status it corrects.
--   * expire_stale_jobs() moves jobs left in New for 15 days to Expired (daily),
--     counting only jobs found (or back in New) after this migration ran.
--   * A guard trigger refuses direct status updates (even by the service role)
--     and refuses clearing a date or reason the status depends on.
--
-- Existing rows are left as they are: nothing is backfilled or converted, and
-- the guards only judge the change being made.

-- ===== Allowed moves =========================================================

create table public.job_status_transitions (
  from_status  public.job_status not null,
  to_status    public.job_status not null,
  -- Moves only the database makes (expiry); change_job_status() refuses them.
  system_only  boolean not null default false,
  primary key (from_status, to_status),
  check (from_status <> to_status)
);

insert into public.job_status_transitions (from_status, to_status, system_only) values
  ('new', 'applied', false), ('new', 'skip', false), ('new', 'expired', true),
  ('applied', 'exam', false), ('applied', 'interview', false), ('applied', 'offer', false),
  ('applied', 'rejected', false), ('applied', 'withdrawn', false),
  -- Emailed is legacy: those jobs move on like Applied ones.
  ('emailed', 'exam', false), ('emailed', 'interview', false), ('emailed', 'offer', false),
  ('emailed', 'rejected', false), ('emailed', 'withdrawn', false),
  ('exam', 'interview', false), ('exam', 'offer', false), ('exam', 'rejected', false),
  ('exam', 'withdrawn', false),
  ('interview', 'offer', false), ('interview', 'rejected', false), ('interview', 'withdrawn', false),
  ('offer', 'rejected', false), ('offer', 'withdrawn', false),
  ('skip', 'new', false),
  ('expired', 'applied', false), ('expired', 'skip', false);
  -- Rejected and Withdrawn are final. Reopening a rejection is an open question
  -- in the plan; until then, Correct status covers it.

-- ===== History: snapshots, kinds, reverts ====================================

alter table public.status_history
  -- 'change' (a move you made), 'correction' (Correct status) or 'expiry'.
  add column kind text not null default 'change'
    check (kind in ('change', 'correction', 'expiry')),
  -- The job's status fields just before and just after the move
  -- (job_status_snapshot). Null on rows written before this migration, which
  -- therefore can't be reverted.
  add column before jsonb,
  add column after jsonb,
  -- Set when the move was undone, or replaced by a correction. The analytics
  -- ignore reverted rows.
  add column reverted_at timestamptz,
  add column reverted_by uuid,
  -- A correction: the row whose status it replaced (marked reverted).
  add column supersedes bigint references public.status_history (id) on delete set null;

-- The fields a status move changes, with timestamps in UTC so two snapshots of
-- the same values always compare equal.
create function public.job_status_snapshot(j public.jobs)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select jsonb_build_object(
    'status', j.status,
    'applied_at', j.applied_at at time zone 'UTC',
    'first_response_at', j.first_response_at at time zone 'UTC',
    'channel', j.channel,
    'skip_reason', j.skip_reason,
    'status_changed_at', j.status_changed_at at time zone 'UTC')
$fn$;

-- ===== Triggers ==============================================================

-- The status machine's functions set this for the length of their statement;
-- the guard below lets their updates through and refuses everyone else's.
--   select set_config('jobtracker.status_change', 'on', true)

-- status_changed_at: now, unless the change sets it itself (a revert restores
-- the old value).
create or replace function public.jobs_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status
     and new.status_changed_at is not distinct from old.status_changed_at then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

create function public.jobs_guard_changes()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if coalesce(current_setting('jobtracker.status_change', true), '') = 'on' then
    return new;
  end if;

  if new.status is distinct from old.status then
    raise exception 'Change a job''s status with change_job_status(), not a direct update'
      using errcode = '42501';
  end if;

  if old.applied_at is not null and new.applied_at is null
     and new.status in ('applied', 'emailed', 'exam', 'interview', 'offer', 'rejected', 'withdrawn') then
    raise exception 'A % job needs the day you applied', new.status using errcode = '23514';
  end if;

  if old.first_response_at is not null and new.first_response_at is null
     and (new.status in ('exam', 'interview', 'offer', 'rejected')
          or (new.status = 'withdrawn' and exists (
                select 1 from public.status_history h
                where h.job_source = new.source and h.job_external_id = new.external_id
                  and h.reverted_at is null
                  and h.to_status in ('exam', 'interview', 'offer', 'rejected')))) then
    raise exception 'A job that heard back needs the day of the first response' using errcode = '23514';
  end if;

  if new.skip_reason is not null and new.skip_reason is distinct from old.skip_reason
     and new.status <> 'skip' then
    raise exception 'Only a skipped job has a skip reason' using errcode = '23514';
  end if;

  return new;
end
$fn$;

create trigger jobs_guard_changes
  before update on public.jobs
  for each row execute function public.jobs_guard_changes();

-- Status changes are written by the functions below, with their snapshots.
drop trigger jobs_log_status_change on public.jobs;
drop function public.jobs_log_status_change();

-- On insert only now: a status change fills its fields in change_job_status().
-- A logged application keeps what you entered; one logged at a later stage
-- keeps an empty first response (plan 1.8).
create or replace function public.jobs_track_application()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.status = 'emailed' then
    raise exception 'Emailed is no longer a status: use Applied with the direct message channel'
      using errcode = '23514';
  end if;

  if new.work_setup = 'unknown' then
    new.work_setup := public.guess_work_setup(new.work_arrangements, new.location);
  end if;

  if new.status in ('applied', 'exam', 'interview', 'offer', 'rejected', 'withdrawn') then
    if new.applied_at is null then
      new.applied_at := now();
    end if;
    if new.channel = 'unknown' and new.source <> 'manual' then
      new.channel := 'job_board';
    end if;
  end if;

  return new;
end
$fn$;

drop trigger jobs_track_application on public.jobs;
create trigger jobs_track_application
  before insert on public.jobs
  for each row execute function public.jobs_track_application();

-- ===== Moving a job ==========================================================

-- Moves a job to p_to, if job_status_transitions allows it. Returns
-- {"history_id": <the new status_history row>, "job": <the job, without its description>}.
--   p_expected_from: the status the caller saw; refused if the job has moved on since.
--   p_skip_reason:   saved with a move to Skip (empty = none).
--   p_channel:       how you applied, for a move to Applied (default: job board
--                    for scraped jobs, if still unknown).
--   p_applied_at:    the day you applied, for a move to Applied (default: now).
create function public.change_job_status(
  p_source public.job_source,
  p_external_id text,
  p_to public.job_status,
  p_expected_from public.job_status default null,
  p_skip_reason text default null,
  p_channel public.application_channel default null,
  p_applied_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  j public.jobs;
  saved public.jobs;
  history_id bigint;
begin
  if not public.is_app_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select * into j from public.jobs
  where source = p_source and external_id = p_external_id
  for update;
  if not found then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;

  if p_expected_from is not null and j.status <> p_expected_from then
    raise exception 'This job is % now, not %: reload and try again', j.status, p_expected_from
      using errcode = '55000';
  end if;

  if not exists (select 1 from public.job_status_transitions t
                 where t.from_status = j.status and t.to_status = p_to and not t.system_only) then
    raise exception 'A job can''t move from % to %', j.status, p_to using errcode = '23514';
  end if;

  perform set_config('jobtracker.status_change', 'on', true);

  update public.jobs set
    status = p_to,
    skip_reason = case when p_to = 'skip' then nullif(btrim(coalesce(p_skip_reason, '')), '') end,
    applied_at = case
      when p_to = 'applied' then coalesce(p_applied_at, j.applied_at, now())
      when p_to in ('exam', 'interview', 'offer', 'rejected', 'withdrawn') then coalesce(j.applied_at, now())
      else j.applied_at end,
    channel = case
      when p_to = 'applied' and p_channel is not null then p_channel
      when p_to = 'applied' and j.channel = 'unknown' and j.source <> 'manual' then 'job_board'
      else j.channel end,
    first_response_at = case
      when p_to in ('exam', 'interview', 'offer', 'rejected') and j.first_response_at is null
        then greatest(now(), coalesce(j.applied_at, now()))
      else j.first_response_at end
  where source = j.source and external_id = j.external_id
  returning * into saved;

  insert into public.status_history
    (job_source, job_external_id, from_status, to_status, kind, before, after)
  values (j.source, j.external_id, j.status, p_to, 'change',
          public.job_status_snapshot(j), public.job_status_snapshot(saved))
  returning id into history_id;

  perform set_config('jobtracker.status_change', '', true);
  return jsonb_build_object('history_id', history_id, 'job', to_jsonb(saved) - 'description');
end
$fn$;

-- Undoes a job's latest status change (or correction, or expiry) exactly: the
-- status fields go back to the snapshot taken before it, and the row is marked
-- reverted. Refused if it isn't the job's latest change, or if the job's status
-- fields were edited since (then use Correct status). Returns {"job": ...}.
create function public.revert_status_change(p_history_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  h public.status_history;
  j public.jobs;
  saved public.jobs;
begin
  if not public.is_app_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select * into h from public.status_history where id = p_history_id for update;
  if not found then
    raise exception 'Change not found' using errcode = 'P0002';
  end if;
  if h.reverted_at is not null then
    raise exception 'That change was already undone' using errcode = '55000';
  end if;
  if h.before is null then
    raise exception 'Changes made before Undo existed can''t be undone: use Correct status'
      using errcode = '55000';
  end if;
  if exists (select 1 from public.status_history n
             where n.job_source = h.job_source and n.job_external_id = h.job_external_id
               and n.id > h.id and n.reverted_at is null) then
    raise exception 'Only the latest change can be undone' using errcode = '55000';
  end if;

  select * into j from public.jobs
  where source = h.job_source and external_id = h.job_external_id
  for update;
  if public.job_status_snapshot(j) is distinct from h.after then
    raise exception 'The job was edited after that change: use Correct status' using errcode = '55000';
  end if;

  perform set_config('jobtracker.status_change', 'on', true);

  update public.jobs set
    status = (h.before ->> 'status')::public.job_status,
    applied_at = (h.before ->> 'applied_at')::timestamp at time zone 'UTC',
    first_response_at = (h.before ->> 'first_response_at')::timestamp at time zone 'UTC',
    channel = (h.before ->> 'channel')::public.application_channel,
    skip_reason = h.before ->> 'skip_reason',
    status_changed_at = (h.before ->> 'status_changed_at')::timestamp at time zone 'UTC'
  where source = j.source and external_id = j.external_id
  returning * into saved;

  update public.status_history set reverted_at = now(), reverted_by = auth.uid() where id = h.id;
  -- Undoing a correction brings back the status it replaced.
  if h.supersedes is not null then
    update public.status_history set reverted_at = null, reverted_by = null where id = h.supersedes;
  end if;

  perform set_config('jobtracker.status_change', '', true);
  return jsonb_build_object('job', to_jsonb(saved) - 'description');
end
$fn$;

-- Fixes a decision after the fact: sets any status (except the legacy Emailed),
-- whatever the allowed moves say. The latest change into the current status is
-- marked reverted, so the analytics count the corrected status instead of both,
-- and the fields follow the corrected status:
--   * New, Skip, Expired: never applied, so no application or response dates.
--   * Applied: applied, no response yet.
--   * Exam, Interview, Offer, Rejected: applied and heard back.
--   * Withdrawn: applied; a response date stays if there was one.
-- Returns {"history_id": ..., "job": ...}, like change_job_status().
create function public.correct_job_status(
  p_source public.job_source,
  p_external_id text,
  p_to public.job_status,
  p_expected_from public.job_status default null,
  p_skip_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  j public.jobs;
  saved public.jobs;
  latest public.status_history;
  replaced bigint;
  history_id bigint;
begin
  if not public.is_app_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_to = 'emailed' then
    raise exception 'Emailed is no longer a status: use Applied with the direct message channel'
      using errcode = '23514';
  end if;

  select * into j from public.jobs
  where source = p_source and external_id = p_external_id
  for update;
  if not found then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  if p_expected_from is not null and j.status <> p_expected_from then
    raise exception 'This job is % now, not %: reload and try again', j.status, p_expected_from
      using errcode = '55000';
  end if;
  if j.status = p_to then
    raise exception 'The job is already %', p_to using errcode = '23514';
  end if;

  select * into latest from public.status_history h
  where h.job_source = j.source and h.job_external_id = j.external_id and h.reverted_at is null
  order by h.id desc
  limit 1;
  if found and latest.to_status = j.status then
    replaced := latest.id;
    update public.status_history set reverted_at = now(), reverted_by = auth.uid() where id = replaced;
  end if;

  perform set_config('jobtracker.status_change', 'on', true);

  update public.jobs set
    status = p_to,
    skip_reason = case when p_to = 'skip' then nullif(btrim(coalesce(p_skip_reason, '')), '') end,
    applied_at = case
      when p_to in ('new', 'skip', 'expired') then null
      else coalesce(j.applied_at, now()) end,
    first_response_at = case
      when p_to in ('new', 'skip', 'expired', 'applied') then null
      when p_to in ('exam', 'interview', 'offer', 'rejected')
        then coalesce(j.first_response_at, greatest(now(), coalesce(j.applied_at, now())))
      else j.first_response_at end,
    channel = case
      when p_to not in ('new', 'skip', 'expired') and j.channel = 'unknown' and j.source <> 'manual'
        then 'job_board'
      else j.channel end
  where source = j.source and external_id = j.external_id
  returning * into saved;

  insert into public.status_history
    (job_source, job_external_id, from_status, to_status, kind, before, after, supersedes)
  values (j.source, j.external_id, j.status, p_to, 'correction',
          public.job_status_snapshot(j), public.job_status_snapshot(saved), replaced)
  returning id into history_id;

  perform set_config('jobtracker.status_change', '', true);
  return jsonb_build_object('history_id', history_id, 'job', to_jsonb(saved) - 'description');
end
$fn$;

-- When expiry started: this migration's run. Jobs already sitting in New
-- before it are existing data and never expire (plan 1.9: existing data is
-- left alone); only jobs found, or brought back to New, from then on do.
create table public.job_expiry_start (
  since timestamptz not null default now(),
  single boolean primary key default true check (single)
);
insert into public.job_expiry_start default values;

-- Moves jobs that sat in New for p_days (since they were found, or since they
-- last came back to New) to Expired, if that was after expiry started. Returns
-- how many. Runs daily (below).
create function public.expire_stale_jobs(p_days integer default 15)
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

-- 16:15 UTC = 00:15 Manila.
select cron.schedule('expire-stale-jobs', '15 16 * * *', 'select public.expire_stale_jobs()');

-- ===== Row-level security and grants =======================================

-- Only the database reads it.
alter table public.job_expiry_start enable row level security;
revoke all on public.job_expiry_start from anon, authenticated;
grant all on public.job_expiry_start to service_role;

alter table public.job_status_transitions enable row level security;

create policy "app users read status transitions" on public.job_status_transitions
  for select to authenticated using ((select public.is_app_user()));

revoke all on public.job_status_transitions from anon, authenticated;
grant select on public.job_status_transitions to authenticated;
grant all on public.job_status_transitions to service_role;

-- The status only changes through the functions above.
revoke update (status) on public.jobs from authenticated;

revoke execute on function
  public.change_job_status(public.job_source, text, public.job_status, public.job_status, text,
                           public.application_channel, timestamptz),
  public.revert_status_change(bigint),
  public.correct_job_status(public.job_source, text, public.job_status, public.job_status, text),
  public.expire_stale_jobs(integer),
  public.job_status_snapshot(public.jobs)
  from public, anon;
grant execute on function
  public.change_job_status(public.job_source, text, public.job_status, public.job_status, text,
                           public.application_channel, timestamptz),
  public.revert_status_change(bigint),
  public.correct_job_status(public.job_source, text, public.job_status, public.job_status, text)
  to authenticated, service_role;
grant execute on function public.expire_stale_jobs(integer), public.job_status_snapshot(public.jobs)
  to service_role;
