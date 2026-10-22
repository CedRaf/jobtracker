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
| Frontend | React + Vite + TypeScript, Tailwind, TanStack Query, supabase-js | Your core stack (resume) |
| Charts | Recharts | Simple, works well with React |
| Drag-and-drop kanban | dnd-kit | Maintained and accessible |
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
- [ ] **Done when:** a scheduled run fills both the sheet and Supabase with the same new jobs. First check: a manual "Run workflow" on GitHub, then the new rows in Table Editor (`jobs`, `filtered_jobs`, `scrape_runs`).

### Phase 2: Dashboard MVP
- [ ] Scaffold `web/` (Vite + React + TS + Tailwind) with a small data layer (`web/src/data/`). Components never call Supabase directly, which makes demo mode easy later.
- [ ] Login: Supabase Auth with GitHub OAuth or an email magic link, restricted to your account.
- [ ] **Jobs feed:**
  - Sortable list, newest or highest score first, with a "new since last visit" badge.
  - Filters: source, status, work arrangement, score, flags, skills, and text search.
- [ ] **Job detail drawer:** full description, matched/missing skills, flags, apply link, email, and status + notes editing.
- [ ] **Filtered view:** dropped jobs grouped by reason, to spot rules that are too aggressive.
- [ ] Deploy to Vercel, with preview deploys on PRs.
- **Done when:** you can do your daily review from the dashboard instead of the sheet.

### Phase 3: Tracker + analytics
- [ ] **Kanban board:** drag cards from New → Applied/Emailed → Interview → Offer/Rejected. Skip asks for a reason.
- [ ] **Analytics page:**
  - New jobs per day by source
  - Most requested skills vs. your skills
  - Application funnel with response rate
  - Median days from applied to first response
  - Filter reasons breakdown
- [ ] **Scraper health panel:** last runs, counts, errors, and a warning if no run happened in 24 h.
- [ ] **"Draft email" button:** opens Gmail compose with the template from `Code.gs` filled in, then sets the status to Emailed.
  - The catch: compose links can't attach the resume, so attach it by hand.
  - If that gets annoying, a Supabase Edge Function can create real Gmail drafts later (see Phase 6).

### Phase 4: Cutover
- [ ] Use the dashboard daily for 1–2 weeks while dual-writing.
- [ ] Remove `"sheet"` from `outputs`, keeping the code so it's a one-line rollback.
- [ ] Replace the Actions-cache `seen_ids.json` with a database lookup of known ids. This removes the cache steps from `scraper.yml`.
- [ ] Trim `Code.gs` down to the timer (`startScraper`, `installScraperTimers`, `githubRequest_`). Keep the sheet itself as an archive.

### Phase 5: Portfolio polish
- [ ] **Public demo:** a second Vercel deployment with `VITE_DEMO=true`. The data layer serves fake jobs from a JSON fixture, and edits only change in-memory state.
  - No real scraped listings or personal data are public, and the demo needs no Supabase project.
- [ ] **README:**
  - One-paragraph pitch, the architecture diagram, and screenshots/GIF of the feed, kanban and analytics
  - Tech stack, how the rules engine works, and local setup
  - The "Sheets prototype → Postgres with dual-writes" story
- [ ] **Resume bullets** (fill in real numbers from `scrape_runs`), for example:
  - "Built a job-aggregation platform that scrapes and scores ~N listings/week from JobStreet and LinkedIn with a configurable rules engine (Python, GitHub Actions)."
  - "Developed a React + TypeScript dashboard backed by Supabase Postgres with row-level security, featuring a kanban application tracker and funnel analytics."
  - "Migrated from a Google Sheets prototype to Postgres using dual-writes, with zero missed runs; CI-tested rules with a regression suite built from real labelled data."

### Phase 6: Optional extras (pick what sounds fun)
- **LLM fit scoring:** a short "why this fits / gaps" summary for each job against your resume, stored next to `match_score`.
- **Rules editor UI:** move keywords, exclusions and skill weights from `config.json` into a `settings` table that you edit in the dashboard.
- **Real Gmail drafts** from the dashboard via a Supabase Edge Function. This needs Google OAuth, so it's more setup.
- **Notifications:** a daily digest email or Discord/Telegram message with the top new matches.

## Decisions for you
- [ ] **Project name** (for the repo, README and resume)?
- [ ] **Public repo:** make this repo public after the Phase 0 privacy pass, or start a fresh public repo and copy the code over? Fresh is safer, because git history still contains personal details and the old `Plan.md`.
- [ ] **This `Plan.md`:** keep it private (out of the public repo) and write a clean `README.md` instead? Recommended.
- [ ] **LinkedIn scraper in the public repo:** LinkedIn's terms forbid scraping. Options: include it, label it as a personal/educational tool, or leave it out of the public version.
- [ ] **Hosting:** Vercel or Cloudflare Pages? (Recommended: Vercel, since your portfolio is already there.)
- [ ] **Login method:** GitHub OAuth or email magic link?
