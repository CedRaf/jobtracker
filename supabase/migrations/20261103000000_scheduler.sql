-- The scraper scheduler: Supabase starts the GitHub Actions workflow itself.
--
-- Every 15 minutes pg_cron calls dispatch_due_scrapers(). It reads the newest
-- settings version's "sources" (each site's on/off switch and start times,
-- Manila time, edited on the dashboard's Schedule tab), and if any site is due
-- in this 15-minute slot, asks GitHub to run scraper.yml with those sites in
-- its `sources` input (pg_net, the same request as the "Run workflow" button).
-- Every request is logged in scraper_dispatches, with GitHub's reply.
--
-- Setup (docs/SCHEDULER_SETUP.md): store a fine-grained GitHub token with
-- "Actions: Read and write" on this repo in Vault, named github_scraper_token.
-- Until then each due slot is logged with a "no GitHub token" error.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
-- Vault (supabase_vault) is enabled in every Supabase project.

-- ===== Which sites are due ===================================================

-- Used for versions saved before "sources" existed, and for sites a version
-- doesn't list; kept identical to scraper/default_settings.json by a test.
create function public.scraper_default_sources()
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select $sources${
    "jobstreet": {"enabled": true, "times": ["11:00", "15:00"]},
    "linkedin": {"enabled": true, "times": ["11:00", "15:00"]},
    "himalayas": {"enabled": true, "times": ["11:00", "15:00"]}
  }$sources$::jsonb
$fn$;

-- The 15-minute slot a moment falls in (11:07 -> 11:00).
create function public.scraper_slot(at timestamptz)
returns timestamptz
language sql
immutable
set search_path = ''
as $fn$
  select date_bin('15 minutes', at, timestamptz '2000-01-01 00:00:00+00')
$fn$;

-- The switched-on sites with a start time in at's slot, Manila time, e.g.
-- {himalayas,jobstreet}. Each site's saved values override its defaults, like
-- scraper/settings.py; a value of the wrong type falls back to the default.
create function public.scraper_due_sources(at timestamptz default now())
returns text[]
language sql
stable
set search_path = ''
as $fn$
  with saved as (
    select coalesce(settings -> 'sources', '{}'::jsonb) as sources
    from public.scraper_settings_versions
    order by version desc
    limit 1
  ),
  sites as (
    select d.key as site,
           coalesce(s.sources -> d.key, '{}'::jsonb) as saved,
           d.value as fallback
    from jsonb_each(public.scraper_default_sources()) d
    left join saved s on true
  ),
  resolved as (
    select site,
           case when jsonb_typeof(saved -> 'enabled') = 'boolean'
                then (saved -> 'enabled')::boolean
                else (fallback -> 'enabled')::boolean end as enabled,
           case when jsonb_typeof(saved -> 'times') = 'array'
                then saved -> 'times'
                else fallback -> 'times' end as times
    from sites
  )
  select coalesce(array_agg(site order by site), '{}')
  from resolved
  where enabled
    and times ? to_char(public.scraper_slot(at) at time zone 'Asia/Manila', 'HH24:MI')
$fn$;

-- ===== Starting runs =========================================================

create table public.scraper_dispatches (
  id           bigint generated always as identity primary key,
  -- The scheduled slot; unique, so a slot never starts two runs. Null for a
  -- run started by hand with dispatch_scrapers().
  slot         timestamptz unique,
  sources      text[] not null,
  -- pg_net's request id; its reply is copied into status_code / error.
  request_id   bigint,
  status_code  integer,      -- 204 = GitHub started the run
  error        text,
  created_at   timestamptz not null default now()
);

create index scraper_dispatches_created_at on public.scraper_dispatches (created_at desc);

-- Asks GitHub to run the scraper for these sites. Returns the log row's id,
-- or null if this slot already started a run. Callable from the SQL editor to
-- test the setup, e.g. select public.dispatch_scrapers(array['himalayas']);
create function public.dispatch_scrapers(p_sources text[], p_slot timestamptz default null)
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
    set error = 'No GitHub token: add the Vault secret github_scraper_token (docs/SCHEDULER_SETUP.md)'
    where id = dispatch_id;
    return dispatch_id;
  end if;

  update public.scraper_dispatches
  set request_id = net.http_post(
    url := 'https://api.github.com/repos/CedRaf/jobtracker/actions/workflows/scraper.yml/dispatches',
    body := jsonb_build_object(
      'ref', 'main',
      'inputs', jsonb_build_object('sources', array_to_string(p_sources, ','))),
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

-- Copies GitHub's replies into the log. pg_net answers asynchronously and keeps
-- replies for about six hours, so each 15-minute tick collects the last ones.
create function public.record_dispatch_replies()
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
      end
  from net._http_response r
  where r.id = d.request_id
    and d.status_code is null
    and d.error is null;
$fn$;

-- What pg_cron runs every 15 minutes.
create function public.dispatch_due_scrapers(at timestamptz default now())
returns bigint
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  due text[];
begin
  perform public.record_dispatch_replies();
  due := public.scraper_due_sources(at);
  if cardinality(due) = 0 then
    return null;
  end if;
  return public.dispatch_scrapers(due, public.scraper_slot(at));
end
$fn$;

select cron.schedule('dispatch-scrapers', '*/15 * * * *', 'select public.dispatch_due_scrapers()');

-- ===== Row-level security and grants =======================================

alter table public.scraper_dispatches enable row level security;

create policy "app users read scraper dispatches" on public.scraper_dispatches
  for select to authenticated using ((select public.is_app_user()));

revoke all on public.scraper_dispatches from anon, authenticated;
grant select on public.scraper_dispatches to authenticated;
grant all on public.scraper_dispatches to service_role;

-- Functions are executable by everyone by default. These start runs or read
-- the token, so only the database itself (pg_cron, the SQL editor) and the
-- service role may call them.
revoke execute on function
  public.scraper_default_sources(), public.scraper_slot(timestamptz),
  public.scraper_due_sources(timestamptz), public.dispatch_scrapers(text[], timestamptz),
  public.record_dispatch_replies(), public.dispatch_due_scrapers(timestamptz)
  from public, anon, authenticated;
grant execute on function
  public.scraper_default_sources(), public.scraper_slot(timestamptz),
  public.scraper_due_sources(timestamptz), public.dispatch_scrapers(text[], timestamptz),
  public.record_dispatch_replies(), public.dispatch_due_scrapers(timestamptz)
  to service_role;
