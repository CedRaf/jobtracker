-- Initial schema: scraped jobs, the filtered-out audit log, status history and
-- scraper run log.
--
-- Access model:
--   * The scraper writes with the secret key (service_role), which bypasses RLS.
--   * The dashboard reads with the publishable key as a logged-in user. Only
--     users listed in app_users can see or change anything, and they can only
--     edit the "yours" columns on jobs (status, skip_reason, notes, ...).

-- ===== Types ================================================================

create type public.job_source as enum ('jobstreet', 'linkedin');

create type public.job_status as enum (
  'new', 'applied', 'emailed', 'interview', 'offer', 'rejected', 'skip'
);

-- ===== Who may use the dashboard ===========================================

-- Add your auth user id here once (SQL editor) after your first login:
--   insert into public.app_users (user_id) values ('<your auth.users id>');
create table public.app_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create function public.is_app_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_users where user_id = auth.uid());
$$;

-- ===== Jobs (listings that passed the rules) ===============================

create table public.jobs (
  source           public.job_source not null,
  external_id      text not null,
  repost_key       text,

  -- From the scraper
  search_terms     text[] not null default '{}',
  title            text not null,
  company          text,
  location         text,
  work_arrangements text[] not null default '{}',
  work_type        text,
  salary_text      text,
  seniority        text,                    -- LinkedIn only
  posted_at        timestamptz,
  apply_type       text,
  apply_link       text,
  match_score      integer not null default 0,
  matched_skills   text[] not null default '{}',
  missing_skills   text[] not null default '{}',
  flags            text[] not null default '{}',
  emails           text[] not null default '{}',
  email_source     text,
  url              text not null,
  description      text,

  -- Yours (edited in the dashboard)
  status           public.job_status not null default 'new',
  status_changed_at timestamptz,
  skip_reason      text,
  notes            text,
  email_drafted_at timestamptz,

  first_seen       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  primary key (source, external_id)
);

create index jobs_status_idx on public.jobs (status);
create index jobs_first_seen_idx on public.jobs (first_seen desc);
create index jobs_repost_key_idx on public.jobs (repost_key);

-- ===== Filtered jobs (audit log of dropped listings) =======================

create table public.filtered_jobs (
  source            public.job_source not null,
  external_id       text not null,
  search_terms      text[] not null default '{}',
  title             text not null,
  company           text,
  location          text,
  work_arrangements text[] not null default '{}',
  reason            text not null,
  url               text not null,
  first_seen        timestamptz not null default now(),

  primary key (source, external_id)
);

create index filtered_jobs_first_seen_idx on public.filtered_jobs (first_seen desc);

-- ===== Status history (filled by trigger) ==================================

create table public.status_history (
  id               bigint generated always as identity primary key,
  job_source       public.job_source not null,
  job_external_id  text not null,
  from_status      public.job_status,
  to_status        public.job_status not null,
  changed_at       timestamptz not null default now(),
  changed_by       uuid default auth.uid(),

  foreign key (job_source, job_external_id)
    references public.jobs (source, external_id) on delete cascade
);

create index status_history_job_idx
  on public.status_history (job_source, job_external_id, changed_at);

-- ===== Scraper runs ========================================================

create table public.scrape_runs (
  id               bigint generated always as identity primary key,
  source           public.job_source not null,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  found            integer,        -- unique jobs in search results
  evaluated        integer,        -- not seen before, so checked against the rules
  kept             integer,
  filtered         integer,
  expired          integer,
  error            text,           -- null = success
  github_run_id    text            -- links the row to its Actions run/log
);

create index scrape_runs_started_at_idx on public.scrape_runs (started_at desc);

-- ===== Triggers ============================================================

create function public.jobs_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

create trigger jobs_before_update
  before update on public.jobs
  for each row execute function public.jobs_before_update();

-- security definer: dashboard users can't insert into status_history directly.
create function public.jobs_log_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.status_history (job_source, job_external_id, from_status, to_status)
  values (new.source, new.external_id, old.status, new.status);
  return null;
end;
$$;

create trigger jobs_log_status_change
  after update of status on public.jobs
  for each row
  when (new.status is distinct from old.status)
  execute function public.jobs_log_status_change();

-- ===== Row-level security ==================================================

alter table public.app_users      enable row level security;
alter table public.jobs           enable row level security;
alter table public.filtered_jobs  enable row level security;
alter table public.status_history enable row level security;
alter table public.scrape_runs    enable row level security;

-- app_users has no policies: only the secret key / SQL editor can read or
-- change it.

create policy "app users read jobs" on public.jobs
  for select to authenticated using ((select public.is_app_user()));

create policy "app users update jobs" on public.jobs
  for update to authenticated
  using ((select public.is_app_user()))
  with check ((select public.is_app_user()));

create policy "app users read filtered jobs" on public.filtered_jobs
  for select to authenticated using ((select public.is_app_user()));

create policy "app users read status history" on public.status_history
  for select to authenticated using ((select public.is_app_user()));

create policy "app users read scrape runs" on public.scrape_runs
  for select to authenticated using ((select public.is_app_user()));

-- ===== Grants ==============================================================
-- Explicit, so access doesn't depend on Supabase's default privileges.
-- The anonymous role gets nothing. Logged-in users can read everything but
-- only update the columns they own on jobs.

revoke all on public.app_users, public.jobs, public.filtered_jobs,
              public.status_history, public.scrape_runs
  from anon, authenticated;

grant select on public.jobs, public.filtered_jobs, public.status_history,
                public.scrape_runs
  to authenticated;

grant update (status, skip_reason, notes, email_drafted_at) on public.jobs
  to authenticated;

grant all on public.app_users, public.jobs, public.filtered_jobs,
             public.status_history, public.scrape_runs
  to service_role;

-- Identity columns: the scraper inserts into scrape_runs.
grant usage, select on sequence public.scrape_runs_id_seq, public.status_history_id_seq
  to service_role;

revoke execute on function public.is_app_user() from public, anon;
grant execute on function public.is_app_user() to authenticated, service_role;
