# Full-stack version: plan (Claude, 2026-10-19)

**Goal:** turn the scraper into a portfolio project. It gets a real database, a web dashboard for tracking applications, tests and CI, and a public demo, all on free tiers. Google Sheets stays as a fallback until the new version proves itself, then gets switched off.

## Architecture

```
Apps Script timer (11 AM / 3 PM) ──starts──> GitHub Actions
                                                 │
                         scraper/ (JobStreet + LinkedIn, rules.py)
                                                 │ upsert (service-role key, server-side only)
                                                 ▼
                                   Supabase: Postgres + Auth + REST API
                                                 ▲
                                                 │ supabase-js (publishable key + row-level security)
                     web/ (React + Vite + TypeScript) on Vercel or Cloudflare Pages
```

- **No server to host.** The scraper keeps running on GitHub Actions. Supabase provides the API, and the frontend is static files.
- **Apps Script stays** only as the timer that starts the workflow. It already works, and no free option replaces it better.
- **Security:**
  - The Supabase **service-role key** lives only in GitHub secrets, used by the scraper.
  - The browser gets only the **publishable (anon) key**. Row-level security (RLS) means only your logged-in user can read or edit data.
  - This replaces the shared-secret token used with Apps Script.

## Stack

| Part | Choice | Why |
|---|---|---|
| Database | Supabase Postgres (free tier) | Real SQL, auth and an auto-generated REST API, with no backend to write |
| Scraper | Existing Python; writes via Supabase's REST API using `requests` | No new dependencies |
| Frontend | React + Vite + TypeScript, TanStack Query, supabase-js | Your core stack (resume) |
| UI components | Ant Design (`antd`) | You know it well. Its Table (sorting, filters, pagination), Drawer, Form, Tag and Statistic cover most of the dashboard, and its theme supports dark mode |
| Charts | Recharts | Simple, works well with React. Ant Design Charts (`@ant-design/charts`) is the alternative if you want charts that match antd's look exactly |
| Drag-and-drop kanban | dnd-kit, with antd Cards as the kanban cards | antd has no drag-and-drop board of its own |
| Hosting | Vercel (Hobby) or Cloudflare Pages | Free static hosting with preview deploys per PR |
| Tests and CI | pytest + ruff (Python), Vitest (web), GitHub Actions on every PR | Shows engineering discipline |

Free-tier terms change, so check current Supabase and Vercel limits when setting up. One known catch: Supabase pauses free projects after about 7 days of no activity. The twice-daily scraper writes keep it active.

## Repo layout (target)

```
scraper/              # current Python files move here
  scraper.py, LinkedIn_Scraper.py, jobstreet_api.py, linkedin_api.py, rules.py
  sinks.py            # new: SheetSink, SupabaseSink
  config.json, requirements.txt
  tests/              # new: pytest
web/                  # new: React app
supabase/
  migrations/         # SQL schema, versioned in git
  seed.sql            # fake demo data
apps_script/Code.gs   # timer (and the sheet, until cutover)
.github/workflows/    # scraper.yml (paths updated), ci.yml (new)
docs/                 # architecture diagram, screenshots
README.md
```

## Database schema (first draft)

**`jobs`**: one row per kept listing.
- **Identity:**
  - `source` (`jobstreet` / `linkedin`) + `external_id`, which together form the **primary key**. Today the sheet keys on `id` alone, so the same number from both sites could collide.
  - `repost_key`
- **From the scraper** (same as `JOB_COLUMNS` in `Code.gs`):
  - `title`, `company`, `location`, `work_arrangement`, `work_type`, `salary_text`, `posted`
  - `apply_type`, `apply_link`, `match_score`, `email`, `email_source`, `url`
  - Lists as Postgres arrays instead of comma-separated text: `search_terms text[]`, `matched_skills text[]`, `missing_skills text[]`, `flags text[]`
  - `description text`: the full description. It isn't stored today; it's needed for the job detail view and for LLM scoring later.
- **Yours** (same as `USER_COLUMNS`):
  - `status`: enum `new | applied | emailed | interview | offer | rejected | skip`. `offer` is new.
  - `skip_reason`, `notes`, `email_drafted_at`
- **Timestamps:** `first_seen` (default `now()`), `updated_at`

**`filtered_jobs`**: the audit log of dropped listings (same as the Filtered tabs). Columns: `source`, `external_id`, `title`, `company`, `location`, `work_arrangement`, `reason`, `url`, `first_seen`.

**`status_history`**: `job (source, external_id)`, `from_status`, `to_status`, `changed_at`.
- A Postgres trigger fills it on every status change.
- It powers the application funnel and the "days to response" charts.

**`scrape_runs`**: one row per scraper run. Columns: `source`, `started_at`, `finished_at`, `found`, `kept`, `filtered`, `expired`, `error`.
- It powers a "scraper health" panel, so you notice when JobStreet changes its API without digging through Actions logs.

**RLS:** every table allows `select`/`update` only for your user id. Inserts come only from the scraper's service-role key, which bypasses RLS.

## Phases

### Phase 0: Groundwork (no behaviour change)
- [x] Move the Python files into `scraper/` and update `scraper.yml` paths.
- [x] Add `scraper/tests/` (74 tests, run with `pytest` from `scraper/`):
  - `test_rules.py`: unit tests for title drops, the location rule, `required_years`, night shift / US hours / language drops, flags, skill scoring, and email/form extraction.
  - `test_regression.py`: replays the title and location rules on 57 labelled jobs from the sheet export (`fixtures/labelled_jobs.json`, with only title, location and work arrangement kept).
    - All 11 Applied/Rejected jobs must be kept.
    - At least 20 of the 46 Skip jobs must still be dropped (`MIN_SKIPS_CAUGHT`; raise it when the rules improve).
    - The export has no job descriptions, so the description rules are only covered by the unit tests. Phase 1 stores descriptions, which allows a fuller regression set later.
- [x] Add `ci.yml`, which runs ruff + pytest on every push and PR. Ruff settings are in `scraper/pyproject.toml`, and dev dependencies in `scraper/requirements-dev.txt`.
- [x] Privacy pass: personal details removed from `Code.gs` (now Script Properties), `TOKEN_SETUP.md` and `rules.py` (now `previous_employers` in `config.json`).
- **Rule gaps found while testing** (left unchanged; Phase 0 changes no behaviour):
  - The night-shift negation only works when "no/not/without" comes right before the match. "Not a night shift role" is still dropped.
  - `html_to_text` leaves a trailing space before some line breaks. This is cosmetic.

### Phase 1: Database + dual-write
- [x] Create the Supabase project and write `supabase/migrations/20261022000000_init.sql` (tables, enums, triggers, RLS, column-level grants). Pushed with `npx supabase db push`.
  - Dashboard access is limited to user ids in `app_users`. Add yours after your first login (Phase 2).
- [x] `scraper/sinks.py`:
  - `SheetSink` wraps `post_to_sheet` and strips the fields the sheet has no columns for (`description`, `repost_key`).
  - `SupabaseSink` inserts through the REST API with `on_conflict=source,external_id` and `resolution=ignore-duplicates`. Existing rows, and so your status and notes, are never overwritten, the same rule as the sheet.
  - Both scrapers now share one `scrape()` flow in `scraper.py`, and both pass the full job description through.
- [x] `"outputs": ["sheet", "supabase"]` in `config.json`.
  - Every output gets every run, even if another fails.
  - If any output fails (or has no credentials), the run fails and jobs aren't marked as seen, so the next run retries them. Both outputs skip ids they already have, so retrying is safe.
- [x] Each run writes a `scrape_runs` row: counts, the error if it failed, and the GitHub run id. Problems writing this log never fail the run.
- [x] GitHub secrets `SUPABASE_URL` and `SUPABASE_SECRET_KEY` added, and passed to both scraper steps in `scraper.yml`. Local runs use the same names in `secrets.json` (see `secrets.example.json`).
- [x] `scraper/import_sheet.py`: a one-off import of the sheet tabs, from their CSV exports. Statuses, notes, draft dates and `first_seen` carry over.
- [x] Tests: `tests/test_sinks.py` (row conversion, REST client, retries, delivery and the run log, all with fake HTTP). 96 tests in total.
- [ ] **Run the import** for each source, before using the dashboard:
  - `python import_sheet.py --source jobstreet --jobs "Jobs.csv" --filtered "Filtered.csv"`
  - `python import_sheet.py --source linkedin --jobs "LinkedIn.csv" --filtered "LinkedIn Filtered.csv"`
- [x] **Done when:** a run fills both the sheet and Supabase with the same new jobs. Verified 2026-10-22 with manual runs: `jobs`, `filtered_jobs` and `scrape_runs` filled from both sources, and a failed output was recorded in `scrape_runs.error`.
  - The first runs found two problems, now fixed: the `SUPABASE_URL` secret had `/rest/v1` on the end (the client now accepts either form), and a one-off Sheet reply without counts (the error now prints the reply if it happens again).
  - A cancelled run leaves its `scrape_runs` row without `finished_at`. Phase 3's health panel should show those as "interrupted".

### Phase 2: Dashboard MVP
Setup steps (login, local run, Vercel): `docs/DASHBOARD_SETUP.md`.

- [x] Scaffold `web/`: Vite 8 + React 19 + TypeScript, Ant Design 6, TanStack Query 5, React Router 7.
  - Data layer in `web/src/data/`: one `DataApi` interface with a Supabase implementation and a demo (sample data) implementation. Components only use the hooks in `hooks.ts`.
  - The list query leaves out `description`; the drawer loads it for the open job only.
  - Demo mode already works (`npm run dev:demo`), so Phase 5's public demo is mostly a deploy.
- [x] Login: Supabase Auth with **email + password**. Simplest option: no email delivery or OAuth app to set up.
  - Access is limited by `app_users`. A signed-in account that isn't listed sees the exact SQL to add it.
  - Turn off public sign-ups in Supabase (see the setup guide).
- [x] **Jobs feed:**
  - Table sorted newest first (score is sortable too), with a dot on jobs new since your last visit.
  - Filters: text (title, company, skills, notes), status (skip/rejected hidden by default), source, arrangement, skills, flags, minimum score, "new since last visit". On phones they fold behind a "Filters" button.
  - Status can be changed inline from the table.
- [x] **Job detail drawer:** status, skip reason and notes editing (with optimistic updates), listing details, emails and form link, skills, flags and the full description. Full-width on phones.
- [x] **Filtered view:** dropped jobs grouped by rule (biggest group first) for the last 7/30/90 days, with the specific match shown per job.
- [x] Tests: 24 Vitest tests (filters, reason grouping, last-visit tracking, and the Jobs page on demo data). The CI workflow has a `web` job: lint, test and build.
- [x] Light/dark mode (follows the system, toggle remembered).
- [x] **Design pass (after first use):**
  - JobStreet and LinkedIn in separate tabs (with counts and a "new" badge); the Source column and filter are gone.
  - The flag filter uses fixed categories (`FLAG_CATEGORIES` in `web/src/lib/flags.ts`, grouped into good signs and concerns) instead of raw flag text. Keep it in sync with the flags `rules.py` emits; a test lists them all.
  - Match score hidden (column, filter and drawer) behind `SHOW_MATCH_SCORE` in `web/src/lib/settings.ts`.
  - Brand colour, Inter font, logo mark, company-initial avatars, and summary cards (new / to review / applied / interviewing / offers) that work as one-click filters.
- [x] **Design pass with Impeccable (2026-10-23):**
  - Product context is in `PRODUCT.md`. The first critique scored 22/40 and the audit 11/20. The main gaps were keyboard access, phone triage, silent status changes, contrast in both themes, and a "new" marker that reset on every reload.
  - **Look:**
    - Teal primary (`#0f766e` in light mode, `#2bb8ad` in dark mode, with dark ink on dark-mode primary buttons).
    - Neutrals tinted toward the teal.
    - Public Sans, self-hosted through `@fontsource-variable/public-sans` (the Google Fonts request is gone).
    - Tabular numbers everywhere.
    - A flat "JT" mark and favicon.
    - All theme tokens are in `web/src/lib/theme.ts`. antd generates grey tints from this dark seed, so the light-mode primary tints are set by hand there.
  - **Colour:**
    - Every status has its own colour: New is teal, Rejected is volcano, and Skip is grey.
    - Status selects show a coloured dot.
    - Avatars are neutral.
    - The stat cards lost their five accent colours and became a toggle bar where "To review" leads. On phones it is one row you scroll sideways.
    - Tags use `ToneTag` (shade 8 on shade 1) so they pass WCAG AA. Secondary text and placeholders are darker than antd's defaults.
    - Light and dark mode were checked by measuring every visible text element.
  - **Behaviour:**
    - Status changes save at once (in the drawer too) and show a "Saved" message with Undo.
    - Picking Skip in the table asks for an optional reason. The row stays listed until the filters change.
    - The drawer asks before throwing away unsaved notes, and has previous/next buttons plus j/k keys.
    - Rows and stat toggles work from the keyboard.
    - Search filters as you type, and Reset clears it.
  - **Freshness:**
    - The header shows the latest `scrape_runs` row for the tab ("Last scrape today 11:04 · 2 kept", or "failed").
    - "New since last visit" now survives reloads: a visit ends after 30 minutes away (`web/src/lib/lastVisit.ts`).
  - **States:**
    - Error alerts have Try again, and a failed load no longer also shows an empty-state message.
    - There's a "You're caught up" state for To review.
    - Long titles are clamped to two lines.
  - **Phones:**
    - The table becomes one stacked column (title, company, up to two flags with concerns first, the status select, and age), with no sideways scroll.
    - Filters are full width.
    - The nav is shortened, and the demo tag stays visible.
  - Tests: 44 (new ones cover visit tracking, keyboard open, skip with a reason, and the caught-up state).
- [x] **Design pass 2 with Impeccable (2026-10-24), covering Board, Analytics and Rules:**
  - The Jobs table no longer scrolls sideways (the LinkedIn tab did with long flags). The table fits the screen, and the tag columns wrap.
  - **Board:** five columns fit a laptop screen. Entry-level tags appear only in New, and the company line is one line.
  - **Rules:** one card surface, rule lists drawn as one bordered list, column headers on Skills and Other stacks, and a prompt before leaving with unsaved edits.
    - The prompt needs a data router, so `App.tsx` now uses `createBrowserRouter`, and tests render through `createMemoryRouter`.
  - **Rule audit loop:**
    - Filtered out reads `?days=&rule=`, opens the biggest or linked group, and has an "Edit rule" link on each group.
    - Rules reads `?tab=&rule=` and highlights the rule. Each title rule shows "Dropped N jobs in the last 30 days", linking back.
    - Analytics "Why jobs were filtered out" bars and table rows open Filtered out with the same period. The mapping is in `web/src/lib/ruleLinks.ts`.
  - **Hidden score:** the Filtered page showed "score N" for low skill match, so `reasonDetail` now hides it. The Rules threshold label talks about skill weights instead of a score.
  - **Quieter rows:** skills are plain text, and the table shows concerns only (good signs are in the drawer and the Entry-level tag). Emailed is gold so it doesn't look like Applied.
  - **Phones:**
    - A bottom tab bar with all five pages.
    - Applied / Emailed / Skip buttons on New jobs.
    - The Saved · Undo message appears above the tab bar.
    - Drawer details fold away.
  - **Critique:** 22/40 → 28/40. Still open: keyboard shortcuts and bulk actions on the table, filters kept in the URL, and "new" being tracked per device.
- [ ] **Your steps:** create your login and add it to `app_users`, then deploy to Vercel (see the setup guide).
- [ ] **Done when:** you can do your daily review from the dashboard instead of the sheet.

### Phase 3: Tracker + analytics
Analytics are computed in the browser from tables RLS already exposes (`jobs`, `status_history`, `filtered_jobs`, `scrape_runs`). That's plenty fast at one person's volume and needs no new SQL views or migrations.

- [x] **Kanban board** (`/board`, `pages/BoardPage.tsx`, dnd-kit):
  - Columns New → Applied → Emailed → Interview → Offer. Rejected and Skip appear with "Show rejected and skipped".
  - Dropping on Skip asks for an optional reason. Every move gets the same Undo toast as the table.
  - Filter by source. Cards open the job drawer.
  - Touch: a short press starts a drag, so the board still scrolls. Keyboard: Enter opens a card, Space picks it up.
- [x] **Analytics page** (`/analytics`, `pages/AnalyticsPage.tsx`, Recharts; logic in `lib/analytics.ts`):
  - Headline tiles: jobs found, applied or emailed, response rate, median days to a response.
  - New jobs per day by source (stacked), the application funnel, filter reasons by rule, your skills employers ask for, and other stacks they ask for.
  - A 30 / 90 / 365-day period switch. Every chart can switch to a table view.
  - Built to the dataviz skill's rules. The source colours (blue/orange) passed its palette validator in light and dark mode against the card surfaces.
  - Funnel stages count jobs that *ever* reached them. Jobs imported from the sheet have no history, so their current status stands in.
- [x] **Scraper health panel** (top of Analytics):
  - Last run per source, with OK / Failed / Running / Interrupted (no finish after an hour).
  - A warning if a source had no run in 24 hours.
  - Success rate over 14 days, and the full runs table (found, checked, kept, filtered, duration).
  - Optional: set `VITE_GITHUB_REPO=CedRaf/jobtracker` to link each run to its Actions log.
- [x] **"Draft in Gmail" button** (job drawer, `components/DraftEmail.tsx`):
  - Opens Gmail's compose window with the template filled in (`{title}`, `{company}`, `{at_company}`).
  - Records `email_drafted_at`, and moves a New or Applied job to Emailed.
  - The template and an optional Gmail account are edited in the dashboard and saved in that browser's local storage, so personal wording stays out of the repo. Set it up once per device.
  - The catch: compose links can't attach files, so attach the resume by hand. A Supabase Edge Function could create real Gmail drafts later (Phase 6).
- [x] Tests: analytics logic, the email template, and the board and analytics pages on demo data (65 web tests in total). The demo data now has a month of jobs, status history and two weeks of scraper runs, including one failed and one interrupted run.

### Editable scraper rules (pulled forward from Phase 6)
The search terms and filter rules used to be hard-coded in `scraper/rules.py` and `config.json`. They're now settings edited on the dashboard's **Rules** page.

- **Storage:** `supabase/migrations/20261024000000_scraper_settings.sql`.
  - The `scraper_settings_versions` table is append-only: every save adds a version, and the newest one is current. Restoring an old version saves it again as a new one, so history is never rewritten.
  - The migration seeds version 1 with the defaults.
  - `scrape_runs.settings_version` records which version each run used.
- **Defaults:** `scraper/default_settings.json`.
  - The same values sit in the migration seed and in `web/src/data/defaultSettings.json`. Scraper tests check that all three match.
- **Scraper:**
  - `settings.py` validates settings, with any missing sections falling back to the defaults.
  - `sinks.load_settings()` loads the newest version at the start of each run. If there are no credentials, Supabase is unreachable, or the saved version is invalid, the run logs it and uses the defaults instead of failing.
  - `rules.py` builds its patterns from the settings. Rules are plain words and phrases, never regexes: matching ignores case and works on whole words, and spaces and hyphens are interchangeable.
  - Compared side by side on 182 real titles and sample descriptions, the old and new rules agree. The one difference is an improvement: "Help-Desk" is now caught.
  - `config.json` keeps only operational settings: location string, sort, delay, retention and outputs.
- **What's editable:**
  - Search keywords, days back, pages per search, radius, and whether to search remote jobs outside Cebu.
  - Title rules: on/off, name and words. You can add or delete rules.
  - Description checks: drop or ignore night shift, foreign hours and language requirements; flag or ignore training bonds.
  - The experience flag and drop thresholds.
  - Skills (weight, spellings, "except when part of…", off-stack), the minimum match score, other stacks, and previous employers.
- **Stays in code:**
  - The home location. LinkedIn needs a location ID, so it can't be a free-text city.
  - The detection patterns for night shift, foreign hours, languages and experience parsing.
  - The positive signals, because the dashboard's flag categories depend on them.
- **Dashboard:** `/rules` (`pages/SettingsPage.tsx`).
  - Tabbed editor with a save bar and an optional note per version.
  - Validation that mirrors the scraper's (`lib/scraperSettings.ts`), so a saved version is never rejected.
  - "Reset to defaults", and a history drawer with what changed in each version and Restore.
- **Entry-level priority** (dashboard only; nothing is dropped):
  - A green "Entry-level" marker on jobs whose title contains a junior-level word (junior, jr, associate, entry level, trainee, graduate, fresh grad, new grad, apprentice, L1, level 1). If switched on, jobs whose description says fresh grads OK / entry level / no experience required get it too. Hover shows why.
  - The Jobs page lists entry-level jobs first: junior titles, then fresh-grad descriptions, then the rest, newest first within each. An "Entry-level first" switch (remembered per browser) turns that off.
  - There's also an "Entry-level only" filter. The marker shows on board cards and in the job drawer.
  - The words live in the `entry_level` settings section (Rules page → Entry-level tab).
  - It's computed in the browser (`web/src/lib/entryLevel.ts`, a port of the scraper's phrase matching), so it applies to existing jobs at once. Versions saved before this section existed use the default words.
- **Order matters when deploying:** push the migration (`npx supabase db push`) before using the new dashboard. The Analytics page now reads `scrape_runs.settings_version`, which doesn't exist until the migration runs. The scraper copes either way.

### Phase 4: Cutover
- [x] **Found during the trial (2026-10-27): LinkedIn rate-limiting.** A run was cancelled at the 45-minute job limit. LinkedIn answered HTTP 429 eleven times, and each 429 cost 2.5 minutes of retries (15 + 45 + 90 s), so the searches alone took 39 minutes and nothing was saved. Fixed:
  - `linkedin_api.py`: one retry after a 429, waiting LinkedIn's `Retry-After` (kept between 5 and 60 s, else 30 s). A second 429 raises `RateLimited`.
  - `LinkedIn_Scraper.py`: on `RateLimited`, it stops requesting for the rest of the run and sends what it has. A **time budget** (20 min) covers the searches and the detail checks; when it runs out, the run wraps up cleanly. Jobs it didn't get to aren't marked as seen, so the next run checks them. A run blocked before any search returns results counts as failed, so the health panel shows it.
  - Fewer and slower requests: 3 pages per search (was 6) and about 5 s between requests (was 2). These are configurable in `config.json` under `"linkedin"`.
  - `scraper.yml`: the LinkedIn step has its own 30-minute limit, so it can never use up the whole job.
  - Tests: `scraper/tests/test_linkedin.py`.
  - LinkedIn rate-limits shared cloud IPs (like GitHub's) much more than home connections, so some runs may still get partial LinkedIn results. JobStreet is unaffected because it runs first.
- [ ] Use the dashboard daily for 1–2 weeks while dual-writing.
- [ ] Remove `"sheet"` from `outputs`, keeping the code so it's a one-line rollback.
- [ ] Replace the Actions-cache `seen_ids.json` with a database lookup of known ids. This removes the cache steps from `scraper.yml`.
- [ ] Trim `Code.gs` down to the timer (`startScraper`, `installScraperTimers`, `githubRequest_`). Keep the sheet itself as an archive.

### Phase 5: Portfolio polish
- [ ] **Optional: link scraper runs to their GitHub logs.** Set `VITE_GITHUB_REPO=CedRaf/jobtracker` in `web/.env.local` and in Vercel's environment variables. The "All runs" table on the Analytics page then gets a link per run. It's a frontend setting (not a GitHub secret). Once the repo is public, anyone can open those run logs.
- [x] **Public demo:** live at https://jobtracker-live-demo.vercel.app/ (linked from the README). A second Vercel project from the same repo. Root Directory `web`, build command `npm run build:demo`, and **no** environment variables.
  - The demo app is ready. The data layer serves made-up jobs, and edits only change in-memory state.
  - It shows one job site only. `DataApi.sources` lists the sites a deployment shows: the demo API returns one, Supabase both. Source tabs, the board's source filter, chart series and scraper health all follow it, and with a single site the tabs and filter are hidden.
  - Site names come from `DataApi.sourceLabels` via `useSourceLabel()`. With a single site, the UI leaves the name out ("26 of 49 jobs", "Last run"), so the demo never names a real job board. Its one leftover label is the generic "Job board".
  - Tests of the multi-site features use `web/src/test/twoSiteApi.ts`.
  - Deployed 2026-10-26. Checked: no login, the Demo tag shows, no site names appear, and direct links like `/analytics` load.
- [x] **README** (`README.md`):
  - Pitch, features, a Mermaid architecture diagram, engineering notes (the spreadsheet → Postgres migration, the regression-tested rules, demo mode through the data layer), the tech stack, screenshots, project structure, local setup and a note on scraping.
  - Job-board names and personal details are left out.
  - Screenshots in `docs/screenshots/` were taken headlessly from the demo, so they show no site names. A phone screenshot wasn't possible headlessly (Chrome won't go below ~500px wide).
- [ ] **Resume bullets** (fill in real numbers from `scrape_runs`), for example:
  - "Built a job-aggregation platform that scrapes and scores ~N listings/week from JobStreet and LinkedIn with a configurable rules engine (Python, GitHub Actions)."
  - "Developed a React + TypeScript dashboard backed by Supabase Postgres with row-level security, featuring a kanban application tracker and funnel analytics."
  - "Migrated from a Google Sheets prototype to Postgres using dual-writes, with zero missed runs; CI-tested rules with a regression suite built from real labelled data."

### Phase 6: Optional extras (pick what sounds fun)
- **LLM fit scoring:** a short "why this fits / gaps" summary for each job against your resume, stored next to `match_score`.
- [x] **Rules editor UI:** done early, see "Editable scraper rules" below.
- [ ] **Rules preview:** in the Rules editor, show what a title-rule edit would change before saving ("3 kept jobs would now be dropped, 5 filtered jobs would be kept"), checked in the browser against the jobs and filtered jobs already loaded.
- **Real Gmail drafts** from the dashboard via a Supabase Edge Function. This needs Google OAuth, so it's more setup.
- **Notifications:** a daily digest email or Discord/Telegram message with the top new matches.

## Decisions for you
- [ ] **Project name** (for the repo, README and resume)?
- [x] **Public repo:** decided 2026-10-26: make **this** repo public, with its full history.
  - A filtered public copy (history rewritten with `git filter-repo` to drop this file and the LinkedIn scraper) was considered, then dropped as too much upkeep: it would need re-publishing after every change.
  - So everything committed is public: all code, this `Plan.md` and its history, commit emails and GitHub Actions run logs.
  - No real secrets or personal contact details were ever committed (checked 2026-10-26). Secrets live only in GitHub secrets, Vercel and gitignored local files.
- [x] **This `Plan.md`:** it stays in the repo as the project's working notes. `README.md` is the public-facing introduction.
- [x] **LinkedIn scraper:** decided 2026-10-26 and revised the same day: it **stays in the repo, for personal and educational use only.**
  - LinkedIn's User Agreement forbids scraping whatever the purpose, not just commercial use.
  - The scraper only reads logged-out, public job listings, twice a day with delays between requests, for one person's job search. Its results are never published or redistributed.
  - It isn't offered as a feature or a product: `LinkedIn_Scraper.py` and `linkedin_api.py` say so at the top, and the README describes the project as aggregating job boards in general.
  - The **public demo** still shows a single, generically named job board, with no LinkedIn tab, data or runs (see "Public demo" in Phase 5).
  - Your own dashboard and scraper keep LinkedIn as they are.
- [x] **Hosting:** Vercel. Two projects from this repo: your dashboard (with the Supabase variables) and the public demo (`npm run build:demo`, no variables).
- [x] **Login method:** email + password (chosen in Phase 2; magic link or GitHub OAuth can be added later).
