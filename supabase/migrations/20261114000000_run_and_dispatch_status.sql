-- Scrape runs and scheduler dispatches as explicit states
-- (docs/STATE_MACHINE_PLAN.md, rollouts 3 and 4: "Machine 2" and "Machine 4").
--
-- Before this, a run's state was guessed from finished_at, error and the clock,
-- and a dispatch's from which of request_id, status_code and error were set.
-- Now each has a stored status, written by whoever changes it:
--
--   scrape_runs.status       running -> ok | failed | interrupted, or skipped
--     * the scraper writes ok or failed when it finishes; ok can carry a
--       warning (something failed after the jobs were delivered);
--     * the workflow's last step closes rows its run left running as
--       interrupted (cancelled, or a step timed out);
--     * a switched-off site writes a skipped row.
--   scraper_dispatches.status  pending -> accepted | failed | lost, or no_token
--     * a request still unanswered after 6 hours is lost (pg_net has dropped
--       the reply by then).
--
-- Each run also records the dispatch that started it (dispatch_id, passed to
-- the workflow as an input), so the dashboard can tell a request GitHub
-- accepted from a run that actually started.
--
-- Deploy the workflow change (the dispatch_id input) to main before pushing
-- this: GitHub refuses a dispatch with an input the workflow doesn't declare.

-- ===== Scrape runs ==========================================================

alter table public.scrape_runs
  add column status text not null default 'running'
    check (status in ('running', 'ok', 'failed', 'interrupted', 'skipped')),
  -- A problem after the jobs were delivered (status stays ok).
  add column warning text,
  add column dispatch_id bigint references public.scraper_dispatches (id) on delete set null;

-- Existing rows get the state the dashboard showed for them.
update public.scrape_runs set status = case
  when error is not null then 'failed'
  when finished_at is not null then 'ok'
  when started_at < now() - interval '1 hour' then 'interrupted'
  else 'running'
end;

-- An error means failed, and failed means an error.
alter table public.scrape_runs
  add constraint scrape_runs_error_means_failed check ((status = 'failed') = (error is not null));

create index scrape_runs_github_run_idx on public.scrape_runs (github_run_id) where status = 'running';

-- ===== Scheduler dispatches ==================================================

alter table public.scraper_dispatches
  add column status text not null default 'pending'
    check (status in ('pending', 'accepted', 'failed', 'lost', 'no_token'));

update public.scraper_dispatches set status = case
  when error like 'No GitHub token%' then 'no_token'
  when status_code between 200 and 299 then 'accepted'
  when error is not null or status_code is not null then 'failed'
  when created_at < now() - interval '6 hours' then 'lost'
  else 'pending'
end;

-- As before, plus the status, and the dispatch's id passed to the workflow.
create or replace function public.dispatch_scrapers(p_sources text[], p_slot timestamptz default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  dispatch_id bigint;
  token text;
begin
  insert into public.scraper_dispatches (slot, sources)
  values (p_slot, p_sources)
  on conflict (slot) do nothing
  returning id into dispatch_id;
  if dispatch_id is null then
    return null;
  end if;

  select decrypted_secret into token
  from vault.decrypted_secrets
  where name = 'github_scraper_token';
  if token is null then
    update public.scraper_dispatches
    set status = 'no_token',
        error = 'No GitHub token: add the Vault secret github_scraper_token (docs/SCHEDULER_SETUP.md)'
    where id = dispatch_id;
    return dispatch_id;
  end if;

  update public.scraper_dispatches
  set request_id = net.http_post(
    url := 'https://api.github.com/repos/CedRaf/jobtracker/actions/workflows/scraper.yml/dispatches',
    body := jsonb_build_object(
      'ref', 'main',
      'inputs', jsonb_build_object(
        'sources', array_to_string(p_sources, ','),
        'dispatch_id', dispatch_id::text)),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'jobtracker-scheduler',
      'Content-Type', 'application/json'),
    timeout_milliseconds := 10000)
  where id = dispatch_id;
  return dispatch_id;
end
$fn$;

-- Copies GitHub's replies into the log, and gives up on requests still
-- unanswered after 6 hours: pg_net keeps replies about that long.
create or replace function public.record_dispatch_replies()
returns void
language sql
security definer
set search_path = ''
as $fn$
  update public.scraper_dispatches d
  set status_code = r.status_code,
      error = case
        when r.error_msg is not null then r.error_msg
        when r.status_code not between 200 and 299 then left(r.content, 300)
      end,
      status = case
        when r.error_msg is null and r.status_code between 200 and 299 then 'accepted'
        else 'failed'
      end
  from net._http_response r
  where r.id = d.request_id
    and d.status = 'pending';

  update public.scraper_dispatches
  set status = 'lost'
  where status = 'pending'
    and created_at < now() - interval '6 hours';
$fn$;
