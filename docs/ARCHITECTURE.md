# JobTracker: architecture and code guide

A reference for how the whole project fits together: what each part does, why it's built that way, and where to change things. Written 2026-10-28; the code is the source of truth if they ever disagree.

Related documents:
- `README.md`: the public introduction.
- `docs/Plan.md`: the phase-by-phase history, decisions and open to-dos.
- `docs/DASHBOARD_SETUP.md`: creating the login and deploying.
- `docs/TOKEN_SETUP.md`: the Apps Script timer's GitHub token.
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
| Scraper | GitHub Actions, started by a Google Apps Script timer at 11:00 and 15:00 Manila time |
| Database and login | Supabase |
| Your dashboard | Vercel project #1 (real data, behind a login) |
| Public demo | Vercel project #2 (built-in sample data, no login): https://jobtracker-live-demo.vercel.app/ |

---

## 2. System architecture

```
                          (11:00 / 15:00 Manila)
 Google Apps Script timer ──"Run workflow" via GitHub API──▶ GitHub Actions: scraper.yml
 (apps_script/Code.gs)                                          │
                                                                │ 1. python scraper.py         (JobStreet)
                                                                │ 2. python LinkedIn_Scraper.py
                                                                │ 3. python Himalayas_Scraper.py (Supabase only)
                                                                ▼
                      ┌──── reads the newest settings version ──── Supabase ◀── upsert jobs, filtered jobs,
                      │                                           (Postgres)     run log (secret key)
   job boards ◀── search + details ── scraper (rules.py)  ─────────────┘
                                          │
                                          └── also posts to the Google Sheet while it's still an output
                                              (Apps Script web app, doPost)

   Browser (phone / PC) ── supabase-js (publishable key + your login token) ──▶ Supabase REST API
   Dashboard (static files on Vercel)                                           └ row-level security decides
```

### What happens in one scraper run

The flow is `scraper.scrape()`, shared by both job boards:
1. Load `config.json` (operational settings) and secrets (environment variables on GitHub Actions, or `scraper/secrets.json` locally).
2. Start a `scrape_runs` row (the run log).
3. Load the **newest scraper settings version** from Supabase. If there's none, it can't be fetched, or it's invalid, use `default_settings.json`. The run never fails because of settings.
4. Compile the rules from the settings (`rules.configure`).
5. **Collect:** run every search (keyword × {home city, remote elsewhere}) and merge the results by job ID.
6. Skip jobs already **seen** in earlier runs (`data/*seen_ids.json`, carried between runs by the GitHub Actions cache).
   Then drop jobs **another site already has**: kept jobs from the other sources in the last `duplicate_lookback_days` (60) are loaded from Supabase and compared on a cleaned title + company key (section 4.8). Matches are filtered as `"duplicate posting (also on JobStreet)"`. If Supabase can't be read, this step is skipped.
7. **Evaluate** each new job:
   1. A title-only check, with no request needed.
   2. Fetch the details.
   3. Description checks, skill scoring and flags.
   4. The result is kept, filtered (with a reason) or expired.
8. **Deliver** to every output in `config.json` `"outputs"` (Supabase, and the Sheet during the cutover), or the source's own `"outputs"` if it has one (Himalayas: Supabase only). Every output is attempted even if one fails. Writes skip IDs that already exist, so retries are safe.
9. Only if every output succeeded, mark the jobs as **seen**. Otherwise the next run retries them.
10. Finish the run-log row with counts, or the error.

### What happens when you use the dashboard

1. **Loading:** the browser downloads static files from Vercel.
2. **Signing in:** supabase-js signs in with email + password and stores the session in localStorage. The access token renews itself, and the refresh token keeps you logged in.
3. **Reading data:** e.g. `GET https://<ref>.supabase.co/rest/v1/jobs?select=…`, with headers `apikey: <publishable key>` and `Authorization: Bearer <your token>`. Postgres row-level security returns rows only if your user ID is in `app_users`.
4. **Changes:** e.g. `PATCH …/jobs?source=eq.jobstreet&external_id=eq.123` with `{"status":"applied"}`. The UI updates at once (optimistic update) and rolls back if the request fails.
5. **Caching:** TanStack Query caches results (60-second freshness, refetch on focus) and saves the cache to localStorage, so a reload shows the last data instantly.

---

## 3. Repository layout

```
.github/workflows/
  ci.yml                 lint + tests + build on every push / PR (scraper and web jobs)
  scraper.yml            the scraper run (manual "Run workflow"; started by Apps Script)
apps_script/Code.gs      Google Apps Script: twice-daily timer, Sheet web app (doPost), Gmail-draft trigger
docs/                    Plan.md, this file, setup guides, screenshots/ (README images)
PRODUCT.md               product context (users, principles) for design work
README.md                public introduction

scraper/
  scraper.py             JobStreet run + the shared scrape() flow, CLI (--dry-run, --limit)
  LinkedIn_Scraper.py    LinkedIn run (personal/educational use: see its header)
  Himalayas_Scraper.py   Himalayas run (remote jobs open to the Philippines; Supabase only)
  jobstreet_api.py       JobStreet client (the site's GraphQL endpoint)
  linkedin_api.py        LinkedIn client (logged-out public job pages, HTML parsing)
  himalayas_api.py       Himalayas client (the public JSON search API)
  rules.py               filtering, flagging and skill scoring, built from the settings
  settings.py            settings validation + defaults loading + search_config()
  default_settings.json  default search terms and rules (also seeded into the DB as version 1)
  sinks.py               outputs (Sheet, Supabase), Supabase REST client, run log, settings loading
  import_sheet.py        one-off import of the Sheet's history into Supabase
  config.json            operational settings (location string, delays, outputs, LinkedIn pacing)
  secrets.example.json   template for local credentials (secrets.json is gitignored)
  pyproject.toml         ruff + pytest config
  tests/                 pytest suites + fixtures/labelled_jobs.json (regression set)

supabase/
  config.toml            Supabase CLI config (local-dev settings only, no secrets)
  migrations/            the schema, applied with `npx supabase db push`

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
  - `config.json` → `"himalayas"`: `delay_seconds` (1) and `outputs` (`["supabase"]`; the Sheet has no Himalayas tabs).
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
- **Stage 1, title only** (`title_drop_reason`): the first enabled title rule with a match drops the job, with the reason `"<rule name> (<matched text>)"`. This runs before fetching details, which saves requests.
- **Location** (`location_drop_reason`): hybrid or on-site jobs outside Cebu are dropped; remote jobs are fine anywhere. The home city is fixed in code, because LinkedIn needs a location ID.
- **Stage 2, description** (`evaluate`):
  - Night shift, US/foreign hours and language requirements: each is *drop* or *off* (patterns are in code and honour negation like "no night shift").
  - Years of experience are parsed from text such as "3+ years", "minimum of five (5) years" or "3-5 yrs exp": drop at N+, flag at M+.
  - Training bond: *flag* or *off*.
  - A blank work arrangement and previous employers are flagged.
- **Skill scoring:** a job's score is the sum of the weights of your skills it mentions (core 3, secondary 2, adjacent 1). Skills can have spellings ("aliases") and "except when part of…" phrases, e.g. React excludes "react native". Jobs below `min_match_score` are dropped (in `scraper.py`), and only when the description was actually fetched.
- **Off-stack flag:** a job that mentions off-stack stacks or skills but none of your core skills.
- **Positive signals** ("fresh grads OK", "will train", …) are fixed in code, because the dashboard's flag categories depend on them.
- **Flags** are strings prefixed `!` (concern) or `+` (good sign). The dashboard groups them through `web/src/lib/flags.ts` `FLAG_CATEGORIES`.

### 4.5 Settings (`settings.py`, `default_settings.json`)
- **Sections:**
  - `search`: keywords, `listed_within_days`, `max_pages_per_search`, `radius_km`, `search_remote_elsewhere`
  - `entry_level`: used only by the dashboard
  - `min_match_score`
  - `experience`: `flag_years`, `drop_years`; null means never
  - `checks`
  - `title_rules`: label, enabled, words
  - `skills`: name, weight, aliases, exclude, off_stack
  - `other_stacks`
  - `previous_employers`
- **`validate(raw)`** returns complete, cleaned settings. Missing sections or keys come from the defaults, words are trimmed and de-duplicated, and anything malformed raises `SettingsError` with a readable path (e.g. `skills[3].weight`).
- **`search_config()`** maps the settings onto the older config key names the scrapers use.
- **The defaults exist in three places, kept identical by tests:**
  - `scraper/default_settings.json`
  - the migration's version-1 seed (sections added later, like `entry_level`, are allowed to be missing there)
  - `web/src/data/defaultSettings.json`

### 4.6 Outputs and the run log (`sinks.py`)
- **`SupabaseClient`:** a thin PostgREST client over `requests`.
  - Accepts the URL with or without `/rest/v1`.
  - New `sb_secret_…` keys go in the `apikey` header; legacy JWT keys also go in `Authorization`.
  - Retries connection errors and 5xx responses (5 s, then 20 s), but not 4xx.
  - Inserts in batches of 500 with `on_conflict=source,external_id` and `ignore-duplicates`. Your dashboard edits are never overwritten.
- **`SheetSink`:** posts to the Apps Script web app and strips the fields the Sheet has no columns for (`description`, `repost_key`).
- **`deliver()`:** writes to every output, then raises if any failed or had no credentials. Jobs aren't marked seen unless everything succeeded.
- **`run_log()`:** a context manager that creates the `scrape_runs` row and finishes it with counts, or the error. Problems writing the log never fail the run. If the database lacks the `settings_version` column, it retries without it.
- **`load_settings()`:** loads the newest settings version (section 4.5) and falls back to the defaults.

### 4.7 Other scraper files
- **`import_sheet.py`:** the one-off import of the Sheet's CSV exports. By default it keeps jobs already in Supabase as they are; `--overwrite` replaces them. It preserves `first_seen`, statuses, notes and draft dates. It's already been run (154 jobs + 216 filtered).
- **`config.json` keys:** `cebu_location` (JobStreet's location string), `sort`, `delay_seconds` (JobStreet pacing), `seen_ids_retention_days`, `duplicate_lookback_days`, `outputs`, `linkedin`, `himalayas`. A source's block may have its own `outputs`, which replaces the shared list for that source (`sinks.output_names`).

### 4.8 Duplicates across sites (`scraper.py`)
- **Two checks.** Within one site, `repost_key()` (exact title + company, kept in the seen list) catches a job reposted under a new ID. Across sites, `cross_site_key()` compares new jobs with the jobs the *other* sites kept recently (`sinks.recent_jobs`), before any details are fetched.
- **The cross-site key** strips what only says how a job is posted:
  - **Title:** parts split off by ` - `, ` | `, ` / `, `:` or brackets are dropped only if *every* word in them is posting noise (remote, full time, urgent hiring, a city, …) or a reference code (`1182`, `080426`, `REQ12345`). So "1182 - Junior Frontend Developer (Part-Time)" becomes "junior frontend developer", while "Developer (RPA)" and "Developer (QA)" stay different.
  - **Company:** a leading "the" and trailing suffixes (Inc, Corp, Ltd, Pty, LLC, Philippines, …) are dropped, so "Hunt St Pty Ltd" matches "Hunt St".
  - No key (so no match) without both a title and a company.
- **Deliberately exact-match, not fuzzy:** a missed duplicate costs a few seconds of review, but a wrong match hides a real job. `tests/test_duplicates.py` has cases for both, including different roles at the same company.
- **The first site wins.** The workflow runs JobStreet → LinkedIn → Himalayas, each delivering before the next starts, so a later site's copy is the one filtered, with the earlier site's name in the reason.
- **Fail-safe:** the lookup reads every recent job and skips the run's own site in Python, not with `source=neq.…`, so it also works before a new source's enum migration is pushed. Any error just skips the cross-site check.
- Checked against the real data on 2026-10-29: 1 cross-site duplicate among 223 kept jobs (the same Hunt St role on LinkedIn and JobStreet), and no wrong matches.

---

## 5. The database (`supabase/migrations/`)

### 5.1 Tables

| Table | What it holds | Key points |
|---|---|---|
| `jobs` | Kept listings | Primary key `(source, external_id)`. Scraper columns (title, company, location, `work_arrangements[]`, salary, `posted_at`, `match_score`, `matched_skills[]`, `missing_skills[]`, `flags[]`, `emails[]`, url, description, `repost_key`, `search_terms[]`), plus **your** columns (`status`, `skip_reason`, `notes`, `email_drafted_at`) and timestamps (`first_seen`, `status_changed_at`, `updated_at`) |
| `filtered_jobs` | Dropped listings | Same key; `reason` text such as `"seniority title (Senior)"` |
| `status_history` | Every status change | Filled by a trigger on `jobs`; feeds the funnel and response-time analytics |
| `scrape_runs` | One row per run per source | found / evaluated / kept / filtered / expired, error (null = OK), `github_run_id`, `settings_version` |
| `scraper_settings_versions` | Append-only settings versions | The newest is current; restoring inserts an old one again. Version 1 = defaults |
| `app_users` | Who may use the dashboard | Your auth user ID; no policies, so only the SQL editor or the secret key can change it |

Enums: `job_source` (`jobstreet`, `linkedin`, `himalayas`) and `job_status` (`new`, `applied`, `emailed`, `interview`, `offer`, `rejected`, `skip`).

### 5.2 Security model
- **Row-level security is on for every table.** Read policies allow only `is_app_user()`, i.e. your auth ID is in `app_users`.
- **Column-level grants:** logged-in users may only `UPDATE` `status`, `skip_reason`, `notes` and `email_drafted_at` on `jobs`, and only `INSERT` `settings` and `note` into settings versions. Nobody but the service role can update or delete history.
- **The `anon` role gets nothing,** so anonymous requests return nothing.
- **The scraper uses the secret key** (service role), which bypasses RLS and is held only in GitHub secrets.
- **The dashboard uses the publishable key,** which is safe in the browser.

### 5.3 Triggers
- `jobs_before_update` sets `updated_at`, and `status_changed_at` when the status changes.
- `jobs_log_status_change` (security definer) inserts into `status_history` on each status change.

### 5.4 Changing the schema
- Add a new file in `supabase/migrations/` (never edit an applied one), run `npx supabase db push`, then `npx supabase migration list` to confirm.
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
  - jobs: list, description, update
  - filtered jobs
  - scrape runs: latest, and the last N days
  - status history
  - settings versions: list and save
  - `auth`
  - `sources` and `sourceLabels`
- **`supabaseApi.ts`:** the real implementation.
  - Lists page through PostgREST's 1,000-row limit.
  - The job list leaves out `description`, which is fetched per job when the drawer opens.
- **`demoApi.ts`:**
  - Uses made-up data from **`demoData.ts`**: a month of jobs, status history, and two weeks of runs including one failed and one interrupted, generated with a seeded random generator so it's the same every load.
  - Keeps everything in memory, so edits reset on reload.
  - Records status history the way the database trigger does.
  - Shows **one generically named site**.
- **`api.ts`:** picks the implementation. Demo when `VITE_DEMO=true` or the mode is `demo` (`npm run dev:demo` / `build:demo`), otherwise Supabase from the `VITE_` variables. It also decides whether the cache is saved (never in demo).
- **`hooks.ts`:** the TanStack Query hooks every component uses.
  - `useJobs`, `useJobDescription`, `useUpdateJob` (optimistic, with rollback, and invalidates status history), `useFilteredJobs`, `useLatestScrapeRuns`, `useScrapeRuns`, `useStatusHistory`, `useSettingsVersions`, `useSaveSettings` (puts the new version into the cache at once).
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
  - Summary cards that double as filters (To review, New since last visit, Applied/emailed, Interviewing, Offers).
  - The filter bar (folds away on phones).
  - **Ordering:** "Entry-level first" by default, newest first within each group.
  - The table: rows show only *concerns* as coloured flags; status changes inline with Undo.
  - **Phones:** stacked rows with quick triage buttons.
  - Opens `JobDrawer` with previous/next and `j`/`k`.
- **Board (`BoardPage.tsx`):**
  - A dnd-kit kanban: New → Applied → Emailed → Interview → Offer, plus Rejected/Skip when switched on.
  - Dropping a card on Skip asks for an optional reason.
  - **Input:** touch uses press-and-hold; on the keyboard, Enter opens a card and Space picks it up.
- **Analytics (`AnalyticsPage.tsx`):**
  - **Scraper health:** last run per site, success rate over 14 days, and a stale warning after 24 hours; runs are OK / Failed / Running / Interrupted (unfinished after an hour).
  - Headline tiles.
  - Charts: new jobs per day, the funnel, filter reasons, your skills in demand, other stacks.
  - Every chart can also show its data as a table. Period: 30 / 90 / 365 days.
  - Analytics are **computed in the browser** (`lib/analytics.ts`); one person's data is small, so no SQL views are needed.
- **Filtered out (`FilteredPage.tsx`):**
  - Dropped jobs grouped by rule, over 7 / 30 / 90 / 365 days.
  - The URL keeps `?days=&rule=`, so other pages can link straight to a group.
  - "Edit rule" links to the matching place on the Rules page (`lib/ruleLinks.ts`).
- **Rules (`SettingsPage.tsx`):**
  - Tabs: Search, Entry-level, Title rules (with drop counts), Description checks, Skills, Other stacks.
  - Built with an antd `Form` and `Form.List`; tag inputs for word lists (Enter or comma adds one).
  - A save bar with an optional note.
  - Validation mirrors the scraper's (`lib/scraperSettings.ts`), so a saved version is never rejected.
  - Navigation is blocked while edits are unsaved.
  - History drawer with what changed in each version and Restore; "Reset to defaults".
  - `?tab=&rule=` deep links.

### 6.5 Shared components (`src/components/`)
- **`AppLayout`:** header navigation on desktop, a **bottom tab bar on phones**, the theme toggle and sign-out.
- **`AuthGate`:** a spinner while the session loads, then the login form, or the "add this user ID to `app_users`" screen (with the SQL to copy), or the app.
- **`JobDrawer`:** job details, the edit form (status, skip reason, notes; leaving with unsaved changes asks first), the Apply section (emails, Draft in Gmail, application form), skills, flags and the description.
- **`StatusControl`:** coloured status dots and select, and the table/phone status cell (Skip asks for a reason; quick buttons on phones). **`useChangeStatus`** saves the change and shows a message with Undo.
- **`DraftEmail`:** "Draft in Gmail" opens Gmail's compose page with your template filled in (`{title}`, `{company}`, `{at_company}`), records `email_drafted_at`, and moves New/Applied to Emailed. The template is kept in **this browser's localStorage** (`lib/emailTemplate.ts`), so personal wording stays out of the repo.
- **`charts.tsx`:** `ChartCard` (chart / table toggle), `DailyJobsChart` (stacked by site, legend only with 2+ sites) and `BarList`. Colours come from `lib/chartColors.ts`, a validated palette.
- **`StatCards`, `JobFiltersBar`, `Tags`** (`ToneTag`, with WCAG-safe text on antd preset colours, plus flag, skill, status and Entry-level tags), **`CompanyAvatar`** and **`GlobalStyles`** (browser styling antd doesn't cover: focus rings, board layout, the save bar, etc.).

### 6.6 Pure logic (`src/lib/`): unit-tested and React-free where possible
- `filters.ts`: the job filters, filter choices and the "new since last visit" test.
- `analytics.ts`: jobs per day, skill demand, the funnel and response rate, median days to a response, run state, stale sources and success rate.
- `entryLevel.ts`: a **port of the scraper's `phrase_pattern`**, the Entry-level marker (title words, or description signals) and its sort rank, plus `useEntryLevel()` (current settings, or the defaults).
- `scraperSettings.ts`: normalising settings, `settingsProblems()` (mirrors `settings.py`) and `changedSections()` for the history.
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
- **GitHub's own cron ran hours late,** so `scraper.yml` has **no schedule**. Instead, `apps_script/Code.gs` `startScraper()` runs at 11:00 and 15:00 Manila time (installed with `installScraperTimers()`). It calls GitHub's "run workflow" API for `GITHUB_REPO` (`CedRaf/jobtracker`), using a fine-grained token stored in a Script Property.
- **`Code.gs` also serves the Sheet** (`doPost` appends rows and skips IDs it already has) and the Gmail-draft trigger, until the Sheet is retired. Personal email wording lives in Script Properties, not in the code.

### 7.2 GitHub Actions
- **`scraper.yml`**, one job (45-minute limit):
  1. restore the seen-ID caches;
  2. JobStreet;
  3. LinkedIn (30-minute step limit);
  4. Himalayas (10-minute step limit; needs only the Supabase secrets);
  5. save the caches;
  6. upload the logs.
- Its secrets are `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SHEET_WEBAPP_URL` and `SHEET_TOKEN`.
- **`ci.yml`** runs on every push and pull request. The `scraper` job runs ruff + pytest; the `web` job runs `npm ci`, lint, Vitest and the build.

### 7.3 Vercel (two projects, same repo, Root Directory `web`)
- **Personal:** the default build, with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Optionally add `VITE_GITHUB_REPO` to get log links in the runs table.
- **Demo:** built with `npm run build:demo` and **no** variables, so it can't reach real data.
- **Both redeploy on every push to `main`.** `web/vercel.json` rewrites every path to `index.html`, so deep links work.
- **Environment variables are baked in at build time.** Redeploy after changing them.

### 7.4 Where secrets live

| Secret | Where |
|---|---|
| Supabase secret key | GitHub Actions secrets; locally only in gitignored `scraper/secrets.json` (delete it when not needed) |
| Supabase publishable key | Vercel (personal project) and `web/.env.local`; safe in the browser |
| Sheet web-app URL + token | GitHub secrets; Apps Script property `SECRET_TOKEN` |
| GitHub token for the timer | Apps Script property `GITHUB_TOKEN` |
| Email template | your browser's localStorage |

No real secret has ever been committed (history checked 2026-10-26). The repo is public.

---

## 8. Testing

| Suite | Where | Count (2026-10-29) | Run with |
|---|---|---|---|
| Scraper | `scraper/tests/` | **199** test cases | `cd scraper && ../.venv/Scripts/python.exe -m pytest` |
| Dashboard | `web/src/**/*.test.ts(x)` | **114** test cases in 16 files | `cd web && npm test` |

Counts are test **cases**; table-driven tests count each input. CI runs both on every push.

**What's covered**
- **`test_rules.py`:** title drops, location, experience parsing, night shift / foreign hours / language, flags, skills, and email/form extraction.
- **`test_regression.py`:** real listings you labelled by hand (`fixtures/labelled_jobs.json`, anonymised). Jobs you applied to must never be dropped, and at least 20 of the 46 you skipped must still be caught (`MIN_SKIPS_CAUGHT`; raise it when the rules improve).
- **`test_settings.py`:** validation, defaults in all three places, settings changing the rules, and settings loading with fallbacks.
- **`test_sinks.py`:** row conversion, the REST client (headers, batching, retries), outputs, delivery and the run log. All against fake HTTP, with no network.
- **`test_linkedin.py`:** 429 handling, `Retry-After`, stopping early, the time budget and page limits.
- **`test_duplicates.py`:** the cross-site key (same jobs formatted differently must match; different roles must not), the lookup and its fallbacks, and duplicates being filtered before evaluation in a run.
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
12. **The Sheet was replaced by dual writes,** so it can be switched off in one line (Phase 4).

---

## 10. Where to change common things

| I want to… | Change |
|---|---|
| Edit search keywords or rules | Dashboard → **Rules** (saved as a new version; the next run uses it) |
| Change the defaults themselves | `scraper/default_settings.json` **and** copy it to `web/src/data/defaultSettings.json` (a test checks they match) |
| Add a description check or positive signal | `scraper/rules.py`, then `web/src/lib/flags.ts` `FLAG_CATEGORIES` and `flags.test.ts` |
| Change LinkedIn pacing or budget | `scraper/config.json` → `"linkedin"` |
| Change where one source writes | `scraper/config.json` → `"<source>": {"outputs": [...]}` |
| Stop writing to the Sheet (Phase 4) | Remove `"sheet"` from `outputs` in `scraper/config.json` |
| Change run times | `SCRAPER_HOURS` in `apps_script/Code.gs`, then run `installScraperTimers()` |
| Add a job source | A client module + `collect()`/`evaluate_jobs()`, a workflow step (plus seen-ID cache steps), a migration adding the enum value, `JobSource` in `types.ts`, `sources`/`sourceLabels` in `supabaseApi.ts` (and the labels in `demoApi.ts`/`twoSiteApi.ts`), `DayCount` in `lib/analytics.ts`, and a validated colour in `lib/chartColors.ts` (Himalayas is the example) |
| Add a database column | A new migration → `db push` → `web/src/data/types.ts` and the `*_COLUMNS` lists in `supabaseApi.ts` → demo data |
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
- **Supabase free projects pause after about a week of no activity.** The twice-daily scraper writes keep it awake.
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

Open (details in `docs/Plan.md`):
- **Phase 4 cutover:**
  - finish the trial period;
  - remove `"sheet"` from `outputs`;
  - swap the seen-ID cache for a database lookup;
  - trim `Code.gs` down to the timer.
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
