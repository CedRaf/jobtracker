# JobTracker: architecture and code guide

A reference for how the whole project fits together: what each part does, why it's built that way, and where to change things. Written 2026-10-28; the code is the source of truth if they ever disagree.

Related documents:
- `README.md`: the public introduction.
- `docs/Plan.md`: the phase-by-phase history, decisions and open to-dos.
- `docs/DASHBOARD_SETUP.md`: creating the login and deploying.
- `docs/SCHEDULER_SETUP.md`: connecting the database scheduler to GitHub (the Vault token).
- `PRODUCT.md`: product context for design work.

---

## 1. What the project is

A personal job-search pipeline with three parts:

1. **A scraper** (Python, `scraper/`). Twice a day it searches three job boards (JobStreet PH, LinkedIn and Himalayas) for junior developer roles, drops what doesn't fit, scores the rest against your skills, flags things worth knowing, and writes everything to the database.
2. **A database** (Supabase: Postgres + Auth + an auto-generated REST API, `supabase/`). It holds jobs, dropped jobs (with reasons), status history, scraper runs and versioned scraper settings.
3. **A dashboard** (React + TypeScript, `web/`). Review new jobs, track applications on a kanban board, see analytics and scraper health, audit dropped jobs, and edit the scraper's rules. It works on desktop and phone.

Everything is hosted on free tiers, and nothing runs on your own machine.

| Piece | Runs on |
|---|---|
| Scraper | GitHub Actions, started by a `pg_cron` scheduler in Supabase at each site's times (set on the dashboard) |
| Database and login | Supabase |
| Your dashboard | Vercel project #1 (real data, behind a login) |
| Public demo | Vercel project #2 (built-in sample data, no login): https://jobtracker-live-demo.vercel.app/ |

---

## 2. System architecture

```
   Supabase pg_cron, every 15 min       (each site's times: Rules → Schedule)
 dispatch_due_scrapers() ──"Run workflow" via GitHub API (pg_net)──▶ GitHub Actions: scraper.yml
 (logs to scraper_dispatches)        sources="jobstreet,…"          │
                                                                    │ 1. python scraper.py      (JobStreet, if due)
                                                                    │ 2. python LinkedIn_Scraper.py  (if due)
                                                                    │ 3. python Himalayas_Scraper.py (if due)
                                                                    ▼
                      ┌──── reads the newest settings version ──── Supabase ◀── upsert jobs, filtered jobs,
                      │                                           (Postgres)     run log (secret key)
   job boards ◀── search + details ── scraper (rules.py)  ─────────────┘

   Browser (phone / PC) ── supabase-js (publishable key + your login token) ──▶ Supabase REST API
   Dashboard (static files on Vercel)                                           └ row-level security decides
```

### What happens in one scraper run

The flow is `scraper.scrape()`, shared by both job boards:
1. Load `config.json` (operational settings) and secrets (environment variables on GitHub Actions, or `scraper/secrets.json` locally).
2. Load the **newest scraper settings version** from Supabase. If there's none, it can't be fetched, or it's invalid, use `default_settings.json`. The run never fails because of settings. **If this site is switched off** (`sources`), stop here, with no run-log row.
3. Start a `scrape_runs` row (the run log, status `running`, with the `dispatch_id` the scheduler passed). A switched-off site instead writes a `skipped` row and stops.
4. Compile the rules from the settings (`rules.configure`).
5. **Collect:** run every search (keyword × {home city, remote elsewhere if this site's switch is on}) and merge the results by job ID.
6. Skip jobs already **seen**: every ID this site has in `jobs`, `filtered_jobs` or `expired_listings`, and the repost keys of its kept jobs, loaded from Supabase before the searches (`sinks.known_listings`; a failed read fails the run). Nothing ages out of it. The cache file (`data/*seen_ids.json`, carried by the GitHub Actions cache) is only used alongside it, and alone when there are no credentials.
   Then drop jobs **another site already has**: kept jobs from the other sources in the last `duplicate_lookback_days` (60) are loaded from Supabase and compared on a cleaned title + company key (section 4.8). Matches are filtered as `"duplicate posting (also on JobStreet)"`. If Supabase can't be read, this step is skipped.
7. **Evaluate** each new job:
   1. A title-only check, with no request needed.
   2. Fetch the details.
   3. Description checks, skill scoring and flags.
   4. The result is kept, filtered (with a reason) or expired.
8. **Deliver** to every output in `config.json` `"outputs"` (Supabase), or the source's own `"outputs"` if it has one: kept jobs, filtered jobs, and listings already closed when first seen (`expired_listings`). Every output is attempted even if one fails. Writes skip IDs that already exist, so retries are safe; jobs that didn't reach the database are judged again next run.
9. Update the cache file.
10. **Re-check closed postings** (section 5.7): this site's jobs still in New, aged 3 to 15 days, are checked with the site and the closed ones move to Expired. At most `recheck_limit` a run (30; LinkedIn 10). Problems are logged and never fail the run.
10. Finish the run-log row with counts, or the error.

### What happens when you use the dashboard

1. **Loading:** the browser downloads static files from Vercel.
2. **Signing in:** supabase-js signs in with email + password and stores the session in localStorage. The access token renews itself, and the refresh token keeps you logged in.
3. **Reading data:** e.g. `GET https://<ref>.supabase.co/rest/v1/jobs?select=…`, with headers `apikey: <publishable key>` and `Authorization: Bearer <your token>`. Postgres row-level security returns rows only if your user ID is in `app_users`.
4. **Changes:** e.g. `PATCH …/jobs?source=eq.jobstreet&external_id=eq.123` with `{"notes":"…"}`, or, for a status, `POST …/rpc/change_job_status` (section 5.6). The UI updates at once (optimistic update) and rolls back if the request fails.
5. **Caching:** TanStack Query caches results (60-second freshness, refetch on focus) and saves the cache to localStorage, so a reload shows the last data instantly.

---

## 3. Repository layout

```
.github/workflows/
  ci.yml                 lint + tests + build on every push / PR (scraper and web jobs)
  scraper.yml            the scraper run (manual "Run workflow"; started by the Supabase scheduler)
docs/                    Plan.md, this file, setup guides, screenshots/ (README images)
PRODUCT.md               product context (users, principles) for design work
README.md                public introduction

scraper/
  scraper.py             JobStreet run + the shared scrape() flow, CLI (--dry-run, --limit)
  LinkedIn_Scraper.py    LinkedIn run (personal/educational use: see its header)
  Himalayas_Scraper.py   Himalayas run (remote jobs open to the Philippines)
  jobstreet_api.py       JobStreet client (the site's GraphQL endpoint)
  linkedin_api.py        LinkedIn client (logged-out public job pages, HTML parsing)
  himalayas_api.py       Himalayas client (the public JSON search API)
  rules.py               filtering, flagging and skill scoring, built from the settings
  settings.py            settings validation + defaults loading + search_config()
  default_settings.json  default search terms and rules (also seeded into the DB as version 1)
  sinks.py               outputs (Supabase), Supabase REST client, run log, settings loading
  import_sheet.py        one-off import of the Sheet's history into Supabase
  config.json            operational settings (location string, delays, outputs, LinkedIn pacing)
  secrets.example.json   template for local credentials (secrets.json is gitignored)
  pyproject.toml         ruff + pytest config
  tests/                 pytest suites + fixtures/labelled_jobs.json (regression set)

supabase/
  config.toml            Supabase CLI config (local-dev settings only, no secrets)
  migrations/            the schema, applied with `npx supabase db push --remote`

web/                     the dashboard (Vite + React + TypeScript)
  index.html, vite.config.ts (incl. Vitest config), vercel.json (SPA rewrites), .env.example
  src/
    main.tsx, App.tsx    entry point; providers + routes
    data/                everything that talks to a backend (see section 6.3)
    lib/                 pure logic and small hooks (filters, analytics, settings validation, …)
    components/          shared UI (layout, drawer, status controls, charts, tags, …)
    pages/               Jobs, Board, Analytics, Filtered out, Rules
    test/                test setup and helpers
```

---

## 4. The scraper (`scraper/`)

### 4.1 Entry points and CLI
- `python scraper.py` runs JobStreet; `python LinkedIn_Scraper.py` runs LinkedIn; `python Himalayas_Scraper.py` runs Himalayas.
- Both accept:
  - `--dry-run`: write CSVs to `output/`, send nothing, mark nothing seen;
  - `--limit N`: only evaluate N new jobs (for quick tests).
- Logs go to `logs/scraper.log`, `logs/linkedin.log` and `logs/himalayas.log`. On GitHub they're uploaded as run artifacts for 7 days.

### 4.2 Source clients
- **`jobstreet_api.py`:** POSTs to `https://ph.jobstreet.com/graphql` using the same queries the website sends (`search()` for 30 results a page; `job_details()` for the full description and whether applying goes off-site). It uses a remote-only filter for the "remote elsewhere" searches.
- **`linkedin_api.py`:** reads LinkedIn's **logged-out** job pages (`jobs-guest` endpoints) and parses the HTML with BeautifulSoup, 10 cards a page. There's no login and no cookies. Logged out, LinkedIn doesn't expose the work arrangement, so it's guessed from the text (`rules.guess_work_arrangements`).
  - **Rate limiting:** an HTTP 429 is retried once, after `Retry-After` (clamped to 5–60 s, default 30 s). A second 429 raises `RateLimited`, and the scraper stops requesting for the rest of the run and keeps what it found.
- **`himalayas_api.py`:** GETs `https://himalayas.app/jobs/api/search?q=<keyword>&country=PH&page=N`, Himalayas' public JSON API (20 jobs a page, no date filter). `country=PH` returns jobs open to the Philippines plus worldwide ones. Each result already has the full description, so there are no per-job requests and no details step. One retry on a 429, like LinkedIn.
  - `Himalayas_Scraper.py` keys jobs by their listing URL (`guid`, minus `https://himalayas.app/companies/`), since there's no numeric ID. Everything is remote, so `work_arrangements` is `["Remote"]`.
  - **Eligibility:** a job whose `locationRestrictions` doesn't include the Philippines, or whose `timezoneRestrictions` doesn't include UTC+8, is dropped ("not open to the Philippines (… only)" / "not open to UTC+8"). Empty lists mean no restriction. Jobs past `expiryDate` count as expired.
  - `config.json` → `"himalayas"`: `delay_seconds` (1).
- **Each source module has a `collect()` and an `evaluate_jobs()`** (search, then per-job evaluation) that `scraper.scrape()` calls. A new source means a new client plus these two functions; nothing else changes.

### 4.3 LinkedIn pacing (`config.json` → `"linkedin"`)
- `max_pages_per_search` (3), `delay_seconds` (5, plus up to 1 s of random jitter) and `time_budget_minutes` (20).
- **The budget** is a deadline shared by the searches and the detail checks. When it runs out, the run wraps up, delivers, and leaves the unchecked jobs unseen for the next run.
- If the scraper is rate-limited before *any* search returns results, the run raises an error, so Scraper health shows it as failed.
- `scraper.yml` also gives the LinkedIn step a 30-minute hard limit.
- **Why:** LinkedIn throttles logged-out requests from shared cloud IPs like GitHub's. The old 15/45/90-second retries once turned a bad day into a 45-minute cancelled run that saved nothing.

### 4.4 Rules (`rules.py`)

The rules come from settings (section 4.5). How matching works is fixed in code:
- **`phrase_pattern(words)`** turns plain words into one case-insensitive regex:
  - **Whole words,** using `(?<!\w)…(?!\w)` lookarounds so `c#` and `.net` work.
  - **Spaces and hyphens are interchangeable or optional:** "help desk" also matches "help-desk" and "helpdesk".
  - **`/` may have spaces around it.**
  - **Longest phrases first,** so the reported match is the most specific.
- **Stage 1, title only** (`title_drop_reason`): the first enabled title rule with a match drops the job, with the reason `"<rule name> (<matched text>)"`. A rule's optional "unless" words keep the job when the title also has one of them (e.g. the support rule skips titles with "developer"; the non-dev rule skips "point of sale"). This runs before fetching details, which saves requests.
- **Location** (`location_drop_reason`): hybrid or on-site jobs outside Cebu are dropped; remote jobs are fine anywhere. The home city is fixed in code, because LinkedIn needs a location ID.
- **Stage 2, description** (`evaluate`):
  - Night shift, US/foreign hours and language requirements: each is *drop* or *off* (patterns are in code and honour negation like "no night shift"). Foreign hours also ignore "overlap with US business hours", which asks for a few shared hours rather than a US shift.
  - Years of experience are parsed from text such as "3+ years of experience", "minimum of five (5) years", "3-5 yrs exp", "2–3 years' experience", "Experience: 3-5 years", requirement lines without the word experience ("- 4+ years as a developer", "must have 3+ years of…") and bracketed years ("Java (3 years)"). A range counts as its lower end; spelled-out numbers count; "a four-year degree" and company history ("over the past 30 years") don't. Drop at N+, flag at M+.
  - Training bond: *flag* or *off*.
  - A blank work arrangement and previous employers are flagged.
- **Skill scoring:** a job's score is the sum of the weights of your skills it mentions (core 3, secondary 2, adjacent 1). Skills can have spellings ("aliases") and "except when part of…" phrases, e.g. React excludes "react native". Jobs below `min_match_score` are dropped (`low_score_reason`, used by every scraper), and only when the description was actually fetched. A description under 600 characters (e.g. a LinkedIn repost's summary) is too short to score, so the job is kept with a `!short description` flag instead.
- **Off-stack flag:** a job that mentions off-stack stacks or skills but none of your core skills.
- **Positive signals** ("fresh grads OK", "will train", …) are fixed in code, because the dashboard's flag categories depend on them.
- **Flags** are strings prefixed `!` (concern) or `+` (good sign). The dashboard groups them through `web/src/lib/flags.ts` `FLAG_CATEGORIES`.

### 4.5 Settings (`settings.py`, `default_settings.json`)
- **Sections:**
  - `search`: keywords, `listed_within_days`, `max_pages_per_search`, `radius_km`, `remote_elsewhere` (per site, `jobstreet`/`linkedin`: also search remote jobs outside Cebu; Himalayas only lists remote jobs. Versions saved before 2026-11-06 have one shared `search_remote_elsewhere`, which applies to both)
  - `entry_level`: used only by the dashboard
  - `min_match_score`
  - `experience`: `flag_years`, `drop_years`; null means never
  - `checks`
  - `title_rules`: label, enabled, words
  - `skills`: name, weight, aliases, exclude, off_stack
  - `other_stacks`
  - `previous_employers`
  - `sources`: per site, `enabled` and `times` (Manila `"HH:MM"` on a 15-minute grid, at most 6, different times across switched-on sites at least 30 minutes apart; see section 7.1)
- **`validate(raw)`** returns complete, cleaned settings. Missing sections or keys come from the defaults, words are trimmed and de-duplicated, and anything malformed raises `SettingsError` with a readable path (e.g. `skills[3].weight`).
- **`search_config()`** maps the settings onto the older config key names the scrapers use.
- **The defaults exist in three places, kept identical by tests:**
  - `scraper/default_settings.json`
  - the migration's version-1 seed (sections added later, `entry_level` and `sources`, are allowed to be missing there)
  - and for `sources` only, `scraper_default_sources()` in the scheduler migration (used for versions without `sources`)
  - `web/src/data/defaultSettings.json`

### 4.6 Outputs and the run log (`sinks.py`)
- **`SupabaseClient`:** a thin PostgREST client over `requests`.
  - Accepts the URL with or without `/rest/v1`.
  - New `sb_secret_…` keys go in the `apikey` header; legacy JWT keys also go in `Authorization`.
  - Retries connection errors and 5xx responses (5 s, then 20 s), but not 4xx.
  - Inserts in batches of 500 with `on_conflict=source,external_id` and `ignore-duplicates`. Your dashboard edits are never overwritten.
- **`deliver()`:** writes to every output, then raises if any failed or had no credentials.
- **`known_listings()`, `jobs_to_recheck()`, `expire_closed_jobs()`:** the seen list from the database, and the closed-posting re-check (`SupabaseClient.rpc` calls the database functions).
- **`run_log()`:** a context manager that creates the `scrape_runs` row and finishes it with counts and a status: `failed` (with the error) if the run raised before delivering, else `ok`. A problem after delivery (the caller sets `stats["delivered"]`) becomes the row's `warning` instead of failing the run, as does a failed closed-posting re-check. Problems writing the log never fail the run: a start that couldn't be written is inserted whole at the end, and an end that couldn't be written goes to `data/pending_runs.json` for the workflow's last step. If the database lacks newer columns (`settings_version`, `status`, `warning`), it retries without them.
- **`record_skipped()`** writes a switched-off site's `skipped` row; **`close_unfinished_runs()`** is the workflow's last step (`close_runs.py`): it replays the pending file, then marks this GitHub run's rows still `running` as `interrupted`.
- **`load_settings()`:** loads the newest settings version (section 4.5) and falls back to the defaults.

### 4.7 Other scraper files
- **`import_sheet.py`:** the one-off import of the Sheet's CSV exports. By default it keeps jobs already in Supabase as they are; `--overwrite` replaces them. It preserves `first_seen`, statuses, notes and draft dates. It's already been run (154 jobs + 216 filtered).
- **`config.json` keys:** `cebu_location` (JobStreet's location string), `sort`, `delay_seconds` (JobStreet pacing), `seen_ids_retention_days` (the cache file only), `duplicate_lookback_days`, `recheck_after_days` (3), `recheck_limit` (30), `outputs`, `linkedin` (its own `recheck_limit`, 10), `himalayas`. A source's block may have its own `outputs`, which replaces the shared list for that source (`sinks.output_names`).

### 4.8 Duplicates across sites (`scraper.py`)
- **Two checks.** Within one site, `repost_key()` (exact title + company, stored in `jobs.repost_key` and loaded with the seen list) catches a job reposted under a new ID. Across sites, `cross_site_key()` compares new jobs with the jobs the *other* sites kept recently (`sinks.recent_jobs`), before any details are fetched.
- **The cross-site key** strips what only says how a job is posted:
  - **Title:** parts split off by ` - `, ` | `, ` / `, `:` or brackets are dropped only if *every* word in them is posting noise (remote, full time, urgent hiring, a city, …) or a reference code (`1182`, `080426`, `REQ12345`). So "1182 - Junior Frontend Developer (Part-Time)" becomes "junior frontend developer", while "Developer (RPA)" and "Developer (QA)" stay different.
  - **Company:** a leading "the" and trailing suffixes (Inc, Corp, Ltd, Pty, LLC, Philippines, …) are dropped, so "Hunt St Pty Ltd" matches "Hunt St".
  - No key (so no match) without both a title and a company.
- **Deliberately exact-match, not fuzzy:** a missed duplicate costs a few seconds of review, but a wrong match hides a real job. `tests/test_duplicates.py` has cases for both, including different roles at the same company.
- **The first site wins.** Whichever site's run finds a job first keeps it; a later site's copy is filtered, with the earlier site's name in the reason. Sites scheduled at the same time run in one workflow, in the order JobStreet → LinkedIn → Himalayas, each delivering before the next starts.
- **Fail-safe:** the lookup reads every recent job and skips the run's own site in Python, not with `source=neq.…`, so it also works before a new source's enum migration is pushed. Any error just skips the cross-site check.
- Checked against the real data on 2026-10-29: 1 cross-site duplicate among 223 kept jobs (the same Hunt St role on LinkedIn and JobStreet), and no wrong matches.

---

## 5. The database (`supabase/migrations/`)

### 5.1 Tables

| Table | What it holds | Key points |
|---|---|---|
| `jobs` | Kept listings | Primary key `(source, external_id)`. Scraper columns (title, company, location, `work_arrangements[]`, salary, `posted_at`, `match_score`, `matched_skills[]`, `missing_skills[]`, `flags[]`, `emails[]`, url, description, `repost_key`, `search_terms[]`), plus **your** columns (`status`, `skip_reason`, `notes`, `email_drafted_at`), **application tracking** (`channel`, `resume_version`, `role_type`, `work_setup`, `applied_at`, `first_response_at`; section 5.5) and timestamps (`first_seen`, `status_changed_at`, `updated_at`) |
| `filtered_jobs` | Dropped listings | Same key; `reason` text such as `"seniority title (Senior)"` |
| `status_history` | Every status change | Written by the status functions (section 5.6) with a `kind` (`change`, `correction`, `expiry`), snapshots of the status fields `before` and `after` (for Undo) and `reverted_at` (undone or corrected away: the analytics skip it); feeds the funnel and response-time analytics |
| `job_status_transitions` | The allowed status moves | `(from_status, to_status, system_only)`; `web/src/lib/transitions.ts` keeps a copy and a test checks they match |
| `scrape_runs` | One row per run per source | `status` (`running`, `ok`, `failed`, `interrupted`, `skipped`), found / evaluated / kept / filtered / expired, `error` (set exactly when failed), `warning` (ok, but something after delivery failed), `github_run_id`, `dispatch_id` (the scheduler request that started it), `settings_version` |
| `scraper_settings_versions` | Append-only settings versions | The newest is current; restoring inserts an old one again. Version 1 = defaults |
| `resume_versions` | Resume variants (`key`, `label`) | Rows, not an enum, so you add one from the drawer's resume dropdown without a migration. `unknown`, `web` and `ai` are seeded |
| `app_users` | Who may use the dashboard | Your auth user ID; no policies, so only the SQL editor or the secret key can change it |
| `scraper_dispatches` | Every request the scheduler sent GitHub | `slot` (unique: one run per 15-minute slot; null when started by hand), `sources[]`, `status` (`pending`, `accepted`, `failed`, `lost`, `no_token`), GitHub's `status_code` (204 = accepted) or `error`. App users can read it; only the database writes it |

Enums: `job_source` (`jobstreet`, `linkedin`, `himalayas`, and `manual` for applications you log yourself), `job_status` (`new`, `applied`, `emailed` (legacy: nothing moves into it), `exam`, `interview`, `offer`, `rejected`, `withdrawn`, `skip`, `expired`), `application_channel`, `role_type` and `work_setup` (each with `unknown`).

### 5.2 Security model
- **Row-level security is on for every table.** Read policies allow only `is_app_user()`, i.e. your auth ID is in `app_users`.
- **Column-level grants:** logged-in users may only `UPDATE` `skip_reason`, `notes`, `email_drafted_at` and the six application-tracking columns on `jobs` (the status changes only through the functions in section 5.6), and only `INSERT` `settings` and `note` into settings versions and `key`, `label` into `resume_versions`. Nobody but the service role can update or delete history.
- **Logged applications:** app users may `INSERT` into `jobs` only with `source = 'manual'` (an RLS policy) and only a short list of columns. Scraped jobs still come from the scraper alone.
- **The `anon` role gets nothing,** so anonymous requests return nothing.
- **The scraper uses the secret key** (service role), which bypasses RLS and is held only in GitHub secrets.
- **The dashboard uses the publishable key,** which is safe in the browser.

### 5.3 The scheduler (`*_scheduler.sql`)
- **`pg_cron`** runs `dispatch_due_scrapers()` every 15 minutes (UTC; the functions convert to Manila).
- **`scraper_due_sources(at)`** reads the newest settings version's `sources` (each site's saved values over `scraper_default_sources()`) and returns the switched-on sites with a time in `at`'s 15-minute slot.
- **`dispatch_scrapers(sources, slot)`** inserts the log row first (a slot already used returns null, so it never starts two runs), reads the token from **Vault** (`github_scraper_token`) and sends GitHub's "run workflow" request through **`pg_net`** with `inputs.sources`. Callable by hand from the SQL editor to test.
- **`record_dispatch_replies()`** copies pg_net's replies (kept about 6 hours) into the log on each tick, setting the status to `accepted` or `failed`; a request still `pending` after 6 hours becomes `lost`.
- **The workflow gets the dispatch's id** (`inputs.dispatch_id`), and each run stores it, so the dashboard can tell a request GitHub accepted from a run that started (`*_run_and_dispatch_status.sql`).
- All of these are `security definer` with `search_path = ''`; `execute` is revoked from `public`, `anon` and `authenticated`, so only the database and the service role can start runs.
- **Tested** on a local Postgres 18 with stand-ins for `cron`, `net` and `vault` (time zones, slots, fallbacks, the one-run-per-slot guard, the missing-token message, the request body, replies and permissions). Supabase's real `pg_cron` and `pg_net` are only exercised once pushed: `docs/SCHEDULER_SETUP.md` Step 3.

### 5.4 Triggers
- `jobs_before_update` sets `updated_at`, and `status_changed_at` when the status changes (unless the change sets it itself, as Undo does).
- `jobs_guard_changes` (section 5.6) refuses direct status updates and clearing a date or reason the status needs.
- `jobs_track_application` (before insert only) refuses the legacy `emailed`, guesses the work setup (`guess_work_setup(arrangements, location)`), and for a job inserted at Applied or later sets `applied_at` if empty and, for scraped jobs, the channel (job board). A logged application keeps what you entered, and one logged at a later stage keeps an empty first response.
- `jobs_log_initial_status` (security definer) records a logged application's starting stage in `status_history`.

### 5.5 Application tracking (`*_application_stages.sql`, `*_application_tracking.sql`)
- **What's stored:** how you applied (`channel`, `resume_version`, `role_type`, `work_setup`) and when (`applied_at`, `first_response_at`). Days to a response is computed from the two dates, never stored.
- **What isn't:** the outcome. `lib/analytics.ts` `deriveOutcome()` takes the furthest stage the job ever reached (offer > interview > exam > rejected > no reply) from its history and current status, so it can't drift from the board; an interview that ended in a rejection still counts as an interview.
- **The backfill:** dates from `status_history` (the first applied/emailed change, else the first later stage); imported jobs without history fall back to `status_changed_at` or `email_drafted_at` for Applied/Emailed and stay null otherwise. Channel from the status (Emailed: direct message; other applications: job board). Work setup from the listing. Everything else is `unknown`.
- **Two files on purpose:** Postgres can't use an enum value in the transaction that adds it, and the second file's policy and backfill use `manual` and `exam`.
- `jobs_response_after_applied` (a check) refuses a response dated before the application; the drawer prevents it too.

### 5.6 The status machine (`*_job_status_values.sql`, `*_job_status_machine.sql`)
The plan and its decisions are in `docs/STATE_MACHINE_PLAN.md` (rollout 1).
- **Allowed moves** (`job_status_transitions`): New → Applied, Skip · Applied (and legacy Emailed) → Exam, Interview, Offer, Rejected, Withdrawn · Exam → Interview, Offer, Rejected, Withdrawn · Interview → Offer, Rejected, Withdrawn · Offer → Rejected, Withdrawn · Skip → New · Expired → Applied, Skip · New → Expired (system only). Rejected and Withdrawn are final.
- **`change_job_status(source, external_id, to, expected_from, skip_reason, channel, applied_at)`** is the only way to move a job. It refuses moves outside the table and stale screens (`expected_from`). In the same statement it sets `applied_at` (the date given, else now) and the channel (given, else job board for scraped jobs) on a move to Applied, `first_response_at` on the first move to Exam, Interview, Offer or Rejected, and `skip_reason` with a skip (cleared on Skip → New). It writes the history row with before/after snapshots and returns `{history_id, job}`.
- **`revert_status_change(history_id)`** (Undo) restores the snapshot exactly and marks the row reverted. Only a job's latest change, and only while its status fields are as that change left them; rows from before this migration have no snapshot. There's no time limit: the toast is a shortcut, and the drawer keeps an Undo button.
- **`correct_job_status(source, external_id, to, expected_from, skip_reason)`** (Correct status) sets any status but Emailed, marks the change that led to the current status reverted, and makes the fields fit: New/Skip/Expired clear both dates, Applied clears the response, Exam/Interview/Offer/Rejected fill both. It can be undone like a change, which brings back the row it replaced.
- **`expire_stale_jobs(days = 15)`** moves jobs left in New for 15 days (since found, or since they came back to New) to Expired, counting only jobs found or back in New after the migration ran (`job_expiry_start`), so the backlog from before stays in New; `pg_cron` runs it daily at 00:15 Manila. Jobs whose posting closed expire sooner (section 5.7).
- **`jobs_guard_changes`** refuses any status update outside these functions (even the service role's or the SQL editor's), clearing `applied_at` once applied, clearing `first_response_at` once they replied, and a skip reason on a job that isn't skipped. It only judges the change being made, so existing rows that break the rules can still be edited.
- **Existing data is left as it is:** nothing is backfilled. Jobs already Emailed keep that status and move on like Applied ones.
- **Open question:** whether Rejected should ever reopen (see the plan). Until then, Correct status covers it.

### 5.7 The listing lifecycle (`*_listing_lifecycle.sql`)
Rollout 2 of `docs/STATE_MACHINE_PLAN.md`.
- **The database is the seen list:** see section 3, step 6. `expired_listings` (service role only) records listings that had already closed when first seen, which used to live only in the cache file.
- **One table per listing:** `listing_in_one_table()` (before-insert triggers on `jobs` for scraped jobs, and on `filtered_jobs`) skips an insert whose key the other table already has, like a duplicate, so a listing is never both kept and filtered.
- **Closed postings:** `jobs_to_recheck(source, min_days = 3, max_days = 15)` lists the site's jobs in New aged 3 to 15 days (older ones expire by age); `expire_closed_jobs(source, ids)` moves those still in New to Expired, logged as an `expiry`. Both count only jobs found (or back in New) after rollout 1 (`job_expiry_start`), and only the service role may call them. Each site decides what "closed" means: JobStreet's details say `isExpired`; LinkedIn's page says it no longer accepts applications, or is gone (stops at a rate limit); Himalayas has no details endpoint, so only a job listed in this run's results with a past expiry date counts. A failed lookup or a job missing from results is left for the next run.
- **Existing data is left as it is,** including listings already in both tables. To list them:
  `select j.source, j.external_id, j.title, j.status from jobs j join filtered_jobs f using (source, external_id);`

### 5.6 Changing the schema
- Add a new file in `supabase/migrations/` (never edit an applied one), run `npx supabase db push --remote`, then `npx supabase migration list --remote` to confirm.
- Don't change tables in the Supabase dashboard; the repo and database would drift apart.
- **Order matters:** push migrations *before* deploying dashboard code that reads new columns.

---

## 6. The dashboard (`web/`)

### 6.1 Stack
- **App:** Vite 8, React 19, TypeScript, **Ant Design 6** (components + theme tokens; no Tailwind), TanStack Query 5 (with a persisted cache), React Router 7 (data router), supabase-js, Recharts 3, dnd-kit, dayjs, and the Public Sans variable font.
- **Quality:** Vitest + Testing Library (jsdom) and oxlint.
- **antd 6 prop names differ from v5.** Use:
  - Drawer: `size`, `destroyOnHidden`
  - Space: `orientation`
  - Alert: `title`
  - Divider: `titlePlacement`
  - Card and Select: `variant`
  - Statistic: `styles.content`

### 6.2 App shell (`main.tsx`, `App.tsx`)
- **Providers, outermost first:**
  1. `ConfigProvider` (theme)
  2. `ThemeModeContext` / `ThemeToggleContext`
  3. `GlobalStyles`
  4. antd `App` (messages and modals)
  5. `ApiContext`
  6. the query provider (persisted unless in demo mode)
  7. `AuthProvider`
  8. `LastVisitContext`
  9. `RouterProvider`
- **Routes** (`createBrowserRouter`, so pages can block navigation): `/` Jobs, `/board`, `/analytics`, `/filtered`, `/rules`. Anything else redirects to `/`. All of them are wrapped in `AuthGate` and `AppLayout`.
- **If Supabase isn't configured** and it's not demo mode, the app shows a "Supabase isn't configured" screen.

### 6.3 Data layer (`src/data/`): the most important design choice

Components never call Supabase directly. Everything goes through one interface.

- **`types.ts`:** the `DataApi` interface and every data type (it mirrors the SQL; keep them in sync). `DataApi` covers:
  - jobs: list, description, update, `logApplication` (inserts a `manual` job)
  - resume versions: list and add
  - filtered jobs
  - scrape runs: latest, and the last N days
  - scheduler dispatches: the latest few
  - status history
  - settings versions: list and save
  - `auth`
  - `sources` and `sourceLabels`
- **`supabaseApi.ts`:** the real implementation.
  - Lists page through PostgREST's 1,000-row limit.
  - The job list leaves out `description`, which is fetched per job when the drawer opens.
- **`demoApi.ts`:**
  - Uses made-up data from **`demoData.ts`**: a month of jobs, 64 past applications with their attributes (some logged by hand; referrals and a resume matching the role get more responses), status history, and two weeks of runs including one failed and one interrupted, generated with a seeded random generator so it's the same every load.
  - Keeps everything in memory, so edits reset on reload.
  - Follows the same status machine as the database (allowed moves, Undo from snapshots, Correct status, the date and reason guards).
  - Shows **one generically named site**.
- **`api.ts`:** picks the implementation. Demo when `VITE_DEMO=true` or the mode is `demo` (`npm run dev:demo` / `build:demo`), otherwise Supabase from the `VITE_` variables. It also decides whether the cache is saved (never in demo).
- **`hooks.ts`:** the TanStack Query hooks every component uses.
  - `useJobs`, `useJobDescription`, `useUpdateJob` (optimistic, with rollback), `useMoveJob` / `useRevertStatus` / `useCorrectStatus` (the status functions: optimistic, with rollback, then refetch status history), `useLogApplication`, `useResumeVersions`, `useAddResumeVersion`, `useFilteredJobs`, `useLatestScrapeRuns`, `useScrapeRuns`, `useDispatches`, `useStatusHistory`, `useSettingsVersions`, `useSaveSettings` (puts the new version into the cache at once).
  - `useSources` and `useSourceLabel`: with **one** site, the UI leaves site names out entirely ("26 of 49 jobs", "Last run").
- **`queryCache.ts`:** the query client and its persistence.
  - 60 s stale time, refetch on window focus, 1 retry.
  - Saved to localStorage for up to 7 days under a version key (`CACHE_VERSION`; bump it when cached data changes shape).
  - Descriptions are never saved (too big).
- **`auth.tsx` / `authContext.ts`:** `AuthProvider` tracks the signed-in user, and **clears all cached data on sign-out**. `useAuth()` reads it.
- **`defaultSettings.ts/.json`:** the dashboard's copy of the scraper defaults.

### 6.4 Pages (`src/pages/`)
- **Jobs (`JobsPage.tsx`):**
  - Source tabs, shown only with 2+ sites.
  - A freshness line (last scrape, last visit).
  - Summary cards that double as filters (To review, New since last visit, Applied/emailed, Exam / interview, Offers).
  - The filter bar (folds away on phones).
  - **Ordering:** "Entry-level first" by default, newest first within each group.
  - The table: rows show only *concerns* as coloured flags; status changes inline with Undo.
  - **Phones:** stacked rows with quick triage buttons.
  - Opens `JobDrawer` with previous/next and `j`/`k`.
- **Board (`BoardPage.tsx`):**
  - A dnd-kit kanban: New → Applied → Exam → Interview → Offer (plus Emailed while legacy jobs have it), and Rejected, Withdrawn, Skip and Expired when switched on. While dragging, only the columns the card may move to take a drop; the others dim. Dropping on Skip asks for the reason first.
  - **Log application** opens a short form for referrals, direct messages and company sites no scraper found. They're stored as `manual` jobs and appear on the board (with a "Logged by you" filter when there are several sites) and in the analytics, but not on the Jobs page, which is for reviewing scraped listings.
  - Dropping a card on Skip asks for an optional reason.
  - **Input:** touch uses press-and-hold; on the keyboard, Enter opens a card and Space picks it up.
- **Analytics (`AnalyticsPage.tsx`):**
  - **Scraper health:** last run per site (marked when switched off), the next scheduled run, success rate over 14 days, a stale warning after 24 hours for scheduled sites only, and an error when the scheduler couldn't start the last run (`lib/schedule.ts` `dispatchProblem`: no token, refused, no reply, or accepted with no run started within 30 minutes). Runs show their stored status (OK, Failed, Running, Interrupted, Skipped), except a run still running after 35 minutes shows as Interrupted (its closing step never ran); an OK run with a warning says the jobs were saved and what failed after.
  - Headline tiles.
  - **What gets responses:** per channel, resume, role type or work setup (a switcher): applications, response rate (any outcome but no reply), interview rate and median days to a reply, each with its sample size, plus a total row. Groups under 10 applications (`MIN_SAMPLE`) are greyed and tagged "Not enough data". Applications count in the period by `applied_at`.
  - **After an exam or interview:** of the applications that reached each, how many went further, were rejected, are still waiting or ended otherwise.
  - Charts: new jobs per day, the funnel, filter reasons, your skills in demand, other stacks.
  - Every chart can also show its data as a table. Period: 30 / 90 / 365 days.
  - Analytics are **computed in the browser** (`lib/analytics.ts`); one person's data is small, so no SQL views are needed.
- **Filtered out (`FilteredPage.tsx`):**
  - Dropped jobs grouped by rule, over 7 / 30 / 90 / 365 days.
  - The URL keeps `?days=&rule=`, so other pages can link straight to a group.
  - "Edit rule" links to the matching place on the Rules page (`lib/ruleLinks.ts`).
- **Rules (`SettingsPage.tsx`):**
  - Tabs: Search (with each site's "remote jobs outside Cebu" switch), Entry-level, Title rules (with drop counts), Description checks, Skills, Other stacks, Schedule (each site's switch and start times; warns when every site is off).
  - Built with an antd `Form` and `Form.List`; tag inputs for word lists (Enter or comma adds one).
  - A save bar with an optional note.
  - Validation mirrors the scraper's (`lib/scraperSettings.ts`), so a saved version is never rejected.
  - Navigation is blocked while edits are unsaved.
  - History drawer with what changed in each version and Restore; "Reset to defaults".
  - `?tab=&rule=` deep links.

### 6.5 Shared components (`src/components/`)
- **`AppLayout`:** header navigation on desktop, a **bottom tab bar on phones**, the theme toggle and sign-out.
- **`AuthGate`:** a spinner while the session loads, then the login form, or the "add this user ID to `app_users`" screen (with the SQL to copy), or the app.
- **`JobDrawer`:** job details, the edit form (status with only the allowed moves, skip reason, notes; leaving with unsaved changes asks first; **Undo** for the job's latest change and **Correct status** for earlier decisions), the **Application** section once you've applied (`ApplicationFields`: channel, resume, role type, work setup and the two dates, each saved as soon as it changes, plus the derived outcome; new resume versions are added from the dropdown), the Apply section (emails, Draft in Gmail, application form), skills, flags and the description.
- **`StatusControl`:** coloured status dots and a select that lists only the allowed moves, and the table/phone status cell (Skip asks for a reason first, then saves both; Applied/Skip quick buttons on phones for New and Expired jobs). **`useChangeStatus`** makes the move and shows a message with Undo.
- **`DraftEmail`:** "Draft in Gmail" opens Gmail's compose page with your template filled in (`{title}`, `{company}`, `{at_company}`), and records `email_drafted_at`; it doesn't change the status. Once drafted, **Mark as applied by email** moves the job to Applied with the direct message channel. The template is kept in **this browser's localStorage** (`lib/emailTemplate.ts`), so personal wording stays out of the repo.
- **`charts.tsx`:** `ChartCard` (chart / table toggle), `DailyJobsChart` (stacked by site, legend only with 2+ sites) and `BarList`. Colours come from `lib/chartColors.ts`, a validated palette.
- **`StatCards`, `JobFiltersBar`, `Tags`** (`ToneTag`, with WCAG-safe text on antd preset colours, plus flag, skill, status and Entry-level tags), **`CompanyAvatar`** and **`GlobalStyles`** (browser styling antd doesn't cover: focus rings, board layout, the save bar, etc.).

### 6.6 Pure logic (`src/lib/`): unit-tested and React-free where possible
- `filters.ts`: the job filters, filter choices and the "new since last visit" test.
- `analytics.ts`: jobs per day, skill demand, the funnel and response rate, days to a response, run state, stale sources and success rate; plus `deriveOutcome`, `applications`, `breakdown` (per dimension) and `dropOff` for application tracking.
- `transitions.ts`: the allowed moves (`TRANSITIONS`, `canMove`), the applied and response stages, what can be corrected, `liveHistory()` (history without undone rows) and `undoableChange()`.
- `application.ts`: labels for the application fields, `APPLIED_STATUSES` and `resumeKey()` (the database's rule for new resume version keys).
- `entryLevel.ts`: a **port of the scraper's `phrase_pattern`**, the Entry-level marker (title words, or description signals) and its sort rank, plus `useEntryLevel()` (current settings, or the defaults).
- `scraperSettings.ts`: normalising settings, `settingsProblems()` (mirrors `settings.py`, including the schedule rules) and `changedSections()` for the history.
- `schedule.ts`: `nextStart()` (the next scheduled run, Manila time), `scheduledSources()`, `dispatchProblem()` (why the scheduler's last request didn't start a run) and `useSchedule()`.
- `flags.ts`: `FLAG_CATEGORIES`. These **must match the flags `rules.py` emits**, and a test lists them all.
- `reasons.ts`: groups filter reasons ("seniority title (Senior)" → "seniority title") and never reveals the hidden match score.
- `ruleLinks.ts`: maps filter reasons to their place on the Rules page and back.
- `lastVisit.ts`: a visit ends after 30 minutes away; the "new" cut-off stays fixed during a visit.
- `emailTemplate.ts`, `format.ts` (dates, error text), `status.ts` (status labels and colours), `theme.ts` (light/dark tokens, follows the system until toggled), `chartColors.ts`, and `settings.ts` (`SHOW_MATCH_SCORE = false`: the score is deliberately hidden everywhere).

### 6.7 Design system
- **Teal** is the primary colour: the review action, "new" and the current filter. The tokens are in `lib/theme.ts`.
- **Font:** Public Sans. Secondary text is darkened to pass WCAG AA in both themes.
- **Dark mode** has its own token set; it isn't just a flip of light mode.
- **Chart colours** are separate from UI colours and were validated for contrast and colour-blindness against the card surfaces.
- See `PRODUCT.md` for the product principles behind it: scanning speed, one action per common task, auditable rules, honest data.

---

## 7. Automation and deployment

### 7.1 Scheduling
- **GitHub's own cron ran hours late,** so `scraper.yml` has **no schedule**. Supabase starts it instead (section 5.3): each site has its own on/off switch and start times on **Rules → Schedule**, and every 15 minutes `pg_cron` starts the due sites through GitHub's "run workflow" API, passing them in the `sources` input. Setup: `docs/SCHEDULER_SETUP.md`.
- **Why different times must be 30+ minutes apart:** `scraper.yml`'s concurrency group allows one running and one waiting run, and a newer waiting run *replaces* the older one. Close start times could silently drop a site's run; sites that share a time go into one run instead. Both validators enforce it.
- **History:** a Google Apps Script timer did this at fixed hours until 2026-11-03, when the database scheduler replaced it (the same day the Google Sheet output was retired). The Sheet is kept as an archive.

### 7.2 GitHub Actions
- **`scraper.yml`**, one job (45-minute limit):
  1. restore the seen-ID caches;
  2. JobStreet;
  3. LinkedIn (30-minute step limit);
  4. Himalayas (10-minute step limit);
  5. close unfinished runs (`close_runs.py`, always runs): replay run-log writes that failed, and mark rows a cancelled or timed-out step left `running` as `interrupted`;
  6. save the caches;
  7. upload the logs.

  Each site's step runs only if the `sources` input names it; blank (a manual run) means every site, and a switched-off site writes a skipped row and exits. The scheduler also passes `dispatch_id` (blank for manual runs).
- Its secrets are `SUPABASE_URL` and `SUPABASE_SECRET_KEY`.
- **`ci.yml`** runs on pushes to `main` and `testing`, and on pull requests. Feature branches are merged into `testing` (checks, no deployment), then `testing` into `main` (deployment). The `scraper` job runs ruff + pytest; the `web` job runs `npm ci`, lint, Vitest and the build.

### 7.3 Vercel (two projects, same repo, Root Directory `web`)
- **Personal:** the default build, with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Optionally add `VITE_GITHUB_REPO` to get log links in the runs table.
- **Demo:** built with `npm run build:demo` and **no** variables, so it can't reach real data.
- **Both redeploy on every push to `main`, and only then.** `web/vercel.json` turns off deployments for every other branch (`git.deploymentEnabled`: `"**": false`, `"main": true`), so feature and `testing` branches get no preview builds. It also rewrites every path to `index.html`, so deep links work.
- **Environment variables are baked in at build time.** Redeploy after changing them.

### 7.4 Where secrets live

| Secret | Where |
|---|---|
| Supabase secret key | GitHub Actions secrets; locally only in gitignored `scraper/secrets.json` (delete it when not needed) |
| Supabase publishable key | Vercel (personal project) and `web/.env.local`; safe in the browser |
| GitHub token for the scheduler | Supabase Vault secret `github_scraper_token` (`docs/SCHEDULER_SETUP.md`) |
| Email template | your browser's localStorage |

No real secret has ever been committed (history checked 2026-10-26). The repo is public.

---

## 8. Testing

| Suite | Where | Count (2026-11-06) | Run with |
|---|---|---|---|
| Scraper and migrations | `scraper/tests/` | **257** test cases (37 need Postgres) | `cd scraper && ../.venv/Scripts/python.exe -m pytest` |
| Dashboard | `web/src/**/*.test.ts(x)` | **172** test cases in 18 files | `cd web && npm test` |

Counts are test **cases**; table-driven tests count each input. CI runs both on every push.

**What's covered**
- **`test_rules.py`:** title drops, location, experience parsing, night shift / foreign hours / language, flags, skills, and email/form extraction.
- **`test_regression.py`:** real listings you labelled by hand (`fixtures/labelled_jobs.json`, anonymised). Jobs you applied to must never be dropped, and at least 20 of the 46 you skipped must still be caught (`MIN_SKIPS_CAUGHT`; raise it when the rules improve).
- **`test_settings.py`:** validation (including the schedule's times and the 30-minute gap), defaults in every place they're kept, settings changing the rules, and settings loading with fallbacks.
- **`test_sinks.py`:** row conversion, the REST client (headers, batching, retries), outputs, delivery and the run log. All against fake HTTP, with no network.
- **`test_linkedin.py`:** 429 handling, `Retry-After`, stopping early, the time budget and page limits.
- **`test_duplicates.py`:** the cross-site key (same jobs formatted differently must match; different roles must not), the lookup and its fallbacks, and duplicates being filtered before evaluation in a run.
- **`test_migrations.py`:** applies every migration to a real Postgres (with stand-ins for Supabase's `auth` schema, roles, `pg_cron`, `pg_net` and Vault), inserting existing jobs before the application-tracking migrations so the backfill runs on realistic rows. Covers the backfill, the triggers, the status machine (allowed moves, Undo, corrections, expiry, the guards, and the transition table matching `transitions.ts`), the listing lifecycle (one table per listing, the re-check window, expiring closed postings), logged applications, resume versions, the dashboard's TypeScript unions matching the enums, and what stays locked (scraper columns, history, outsiders, `anon`). Runs only when `TEST_DATABASE_URL` is set: CI starts a `postgres` service; locally, any Postgres 15+ where you may create databases (each run creates and drops its own).
- **`test_listings.py`:** the seen check from the database (cache evicted, repost keys, a failed read), the closed-posting re-check per site (limits, rate limits, failures), and the sink calls.
- **`test_himalayas.py`:** the client (query, 429, bad responses), field mapping, the country/timezone eligibility rule, paging, stopping early, expired jobs and duplicates.
- **Dashboard logic** (`lib/*.test.ts`): filters, analytics, entry-level matching, rule validation, flags, reasons, rule links, the email template, last visit, and (in `data/`) the query cache and auth clearing.
- **Dashboard pages** (`pages/*.test.tsx`): render real pages on demo data and click through them. Multi-site behaviour uses `test/twoSiteApi.ts`, which relabels some demo jobs as a second site.

**Test setup quirks** (`web/src/test/setup.ts`, `vite.config.ts`)
- jsdom lacks `ResizeObserver` and `matchMedia`; both are stubbed, with `matchMedia` acting as a desktop screen.
- Cleanup and `localStorage.clear()` run after each test.
- `testTimeout` is 20 s, because antd form tests are slow on CI.

---

## 9. Key design decisions (and why)

1. **No custom server.** Supabase's REST API, row-level security and Auth replace a backend. The scraper runs on Actions and the dashboard is static, so it costs $0 and there's nothing to keep running.
2. **Security in the database, not the client.** Row-level security plus column grants, with `app_users` as an allow-list. A leaked publishable key or URL exposes nothing.
3. **One `DataApi` interface.** It makes demo mode a build flag, makes page tests easy, and keeps Supabase details in one file.
4. **Rules as plain words, compiled in code.** You never write regexes; invalid patterns can't break a run; the same matching runs in Python and TypeScript.
5. **Append-only, versioned settings.** Every change has a history and can be rolled back; each run records which version it used.
6. **Fail safe, retry later.** Outputs skip duplicates, jobs are marked seen only after a successful delivery, settings fall back to the defaults, and the run log never fails a run.
7. **Auditability.** Every dropped job keeps its reason (the Filtered page), and every status change is logged (the analytics).
8. **Analytics in the browser.** One person's data is small, so there are no SQL views or extra migrations.
9. **Optimistic updates with Undo.** Status changes feel instant on a phone.
10. **Single-site deployments hide site names.** The public demo never names a real job board.
11. **LinkedIn stays a personal, educational tool,** paced and time-boxed. The demo leaves it out.
12. **The Sheet was replaced by dual writes,** then switched off once the dashboard had taken over (Phase 4, 2026-11-03).

---

## 10. Where to change common things

| I want to… | Change |
|---|---|
| Edit search keywords or rules | Dashboard → **Rules** (saved as a new version; the next run uses it) |
| Change the defaults themselves | `scraper/default_settings.json` **and** copy it to `web/src/data/defaultSettings.json` (a test checks they match) |
| Add a description check or positive signal | `scraper/rules.py`, then `web/src/lib/flags.ts` `FLAG_CATEGORIES` and `flags.test.ts` |
| Change LinkedIn pacing or budget | `scraper/config.json` → `"linkedin"` |
| Change where one source writes | `scraper/config.json` → `"<source>": {"outputs": [...]}` |
| Change run times or switch a site off | Dashboard → **Rules → Schedule** |
| Add a job source | A client module + `collect()`/`evaluate_jobs()`, a workflow step (plus seen-ID cache steps), a migration adding the enum value, `JobSource` in `types.ts`, `sources`/`sourceLabels` in `supabaseApi.ts` (and the labels in `demoApi.ts`/`twoSiteApi.ts`), `DayCount` in `lib/analytics.ts`, and a validated colour in `lib/chartColors.ts` (Himalayas is the example) |
| Add a database column | A new migration → `db push` → `web/src/data/types.ts` and the `*_COLUMNS` lists in `supabaseApi.ts` → demo data |
| Add a resume version | The resume dropdown in a job's drawer → Add (no code change) |
| Add a channel, role type or work setup | A migration (`alter type … add value`) → the union in `types.ts` (`test_migrations.py` checks they match) → the labels in `lib/application.ts` |
| Show the match score again | `web/src/lib/settings.ts` → `SHOW_MATCH_SCORE = true` |
| Change colours or fonts | `web/src/lib/theme.ts` (UI) and `lib/chartColors.ts` (charts) |
| Run the app locally | `cd web && npm run dev` (real data, needs `.env.local`) or `npm run dev:demo` |
| Run the scraper locally | `cd scraper && ../.venv/Scripts/python.exe scraper.py --dry-run --limit 5` |

---

## 11. Known limitations and gotchas

- **LinkedIn may give partial results** on days its rate limiting is strict (shared GitHub IPs). JobStreet runs first and isn't affected. If most runs get blocked, the next step is running LinkedIn from a less-shared IP.
- **The seen-ID lists live in the GitHub Actions cache,** not the database. A cache miss just means a run re-checks jobs; nothing is duplicated. Replacing it with a database lookup is a Phase 4 item.
- **The home city (Cebu) is fixed in code** (`rules.is_cebu`, `config.json` `cebu_location`, `linkedin_api.CEBU`).
- **Jobs imported from the Sheet have no status history,** so analytics fall back to their current status for the funnel.
- **iPhone Safari clears site data after 7 days without a visit.** Adding the dashboard to the Home Screen avoids it.
- **The email template is per browser,** so set it up once on each device.
- **Supabase free projects pause after about a week of no activity.** The scraper's writes and your dashboard visits keep it awake. With every site switched off, only the visits do, and a paused project stops its own scheduler.
- **Screenshots for the README** are taken from the demo with headless Chrome. Phone-width captures don't work headlessly (Chrome won't go below about 500 px).

---

## 12. Status and what's next (as of 2026-10-28)

Done:
- **Phases 0–3:** tests and CI; Supabase and dual writes; the dashboard; the board, analytics and Draft in Gmail.
- **Pulled forward from Phase 6:** editable versioned rules and entry-level priority.
- **The Sheet history import.**
- **Deployments:** both Vercel deployments and the README with the demo link.
- **The LinkedIn rate-limit fix.**
- **Himalayas as a third source** (2026-10-29).
- **Duplicates across sites** (2026-10-29).
- **The Sheet retired** (2026-11-03): Supabase is the only output.
- **Per-site schedules in Supabase** (2026-11-03): `pg_cron` replaced the Apps Script timer; sites can be switched off and timed separately on the Schedule tab.

Open (details in `docs/Plan.md`):
- **Phase 4 cutover:**
  - swap the seen-ID cache for a database lookup.
- **Phase 5:** resume bullets (drafted; refresh the numbers in a month). Optional: `VITE_GITHUB_REPO` for run-log links.
- **Possible next features:**
  - more remote sources if Himalayas proves useful: Jobicy or Remotive, or Greenhouse/Lever/Ashby public job boards for a chosen list of companies (`boards-api.greenhouse.io/v1/boards/<company>/jobs`). A new source needs a client plus `collect()`/`evaluate_jobs()` (see section 10);
  - the Rules preview;
  - LLM fit scoring;
  - real Gmail drafts through an Edge Function;
  - notifications.
- **Suggested keyword changes** (based on the data from 2026-10-28):
  - **remove:** junior software engineer, junior react developer, entry level developer, software engineer trainee;
  - **add:** junior programmer, application developer, graduate software engineer, junior frontend developer, junior backend developer;
  - **add skills:** HTML, CSS, Supabase, CI/CD.
