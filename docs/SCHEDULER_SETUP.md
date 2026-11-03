# Scheduler setup

Supabase starts the scraper: every 15 minutes a database job checks the **Schedule** tab's times and, when a site is due, asks GitHub to run the scraper workflow for it. This guide connects it to GitHub (about 10 minutes) and switches off the old Apps Script timer.

## How it fits together

```
Rules page → Schedule tab (each site: on/off + start times, Manila)
   │  saved as a new settings version
   ▼
Supabase pg_cron, every 15 min → dispatch_due_scrapers()
   │  due sites? → pg_net POST to GitHub with the Vault token
   │  logs every request in scraper_dispatches
   ▼
GitHub Actions scraper.yml, input sources="jobstreet,himalayas"
   │  runs only those sites' steps
   ▼
Supabase (jobs, filtered jobs, run log)
```

## Secrets

| Name | Where it lives | What it's for |
|---|---|---|
| **`github_scraper_token`** | Supabase → Vault | Lets the scheduler start the GitHub workflow (**this guide**) |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | GitHub repo → Settings → Secrets and variables → Actions | Lets the scraper write to Supabase (`DASHBOARD_SETUP.md`) |

> Never put the token in a migration or any file in the repo. The repo is public. Vault keeps it encrypted inside the database.

---

## Step 1: Push the migration

```bash
npx supabase db push --remote
```

This enables `pg_cron` and `pg_net`, creates the `scraper_dispatches` log and the scheduling functions, and schedules the 15-minute job. Until Step 2 is done, each due slot is logged with a "No GitHub token" error and nothing starts.

## Step 2: Store the GitHub token in Vault

You can reuse the token the Apps Script timer uses: open Apps Script → **Project Settings → Script Properties** and copy `GITHUB_TOKEN`. (GitHub won't show it again, but Script Properties does.) Or make a new one, see "A new token" below.

In the Supabase dashboard → **SQL Editor**, run (with your token in place of the placeholder):

```sql
select vault.create_secret('github_pat_PASTE_TOKEN_HERE', 'github_scraper_token', 'Starts the scraper workflow');
```

Don't save the query in the SQL editor afterwards, since it contains the token.

## Step 3: Test it (starts a real run)

**First merge the scheduler change into `main`.** GitHub runs the workflow file on `main`; until it has the `sources` input, GitHub refuses the request with HTTP 422 ("Unexpected inputs provided") and no run starts. To see GitHub's reply straight away rather than after the next 15-minute check: `select status_code, content, error_msg from net._http_response order by id desc limit 3;`

Then, in the SQL Editor:

```sql
select public.dispatch_scrapers(array['himalayas']);
```

Within a few seconds a run appears on GitHub → **Actions**, with **Sites: himalayas** in its "Show trigger" step. Himalayas is the quickest site to test with. To see GitHub's reply (`204` = started), run this about 15 minutes later, once the next check has collected it:

```sql
select created_at, sources, status_code, error from public.scraper_dispatches order by id desc limit 5;
```

## Step 4: Switch off the Apps Script timer (same day)

Otherwise both schedulers start runs. In Apps Script, pick **`removeScraperTimers`** in the function dropdown → **Run**. Then **Triggers** (clock icon) should list nothing. Delete the `GITHUB_TOKEN` script property too, and the Apps Script project if you like; nothing uses it any more.

## Step 5: Set the times

On the dashboard → **Rules → Schedule**, set each site's switch and start times and save. Supabase uses them from the next 15-minute check, and **Analytics → Scraper health** shows when the next run is due.

---

## Rules for the times

- Manila time, on the hour or at :15, :30 or :45 (the scheduler checks every 15 minutes).
- At most 6 runs a day per site.
- **Different times must be at least 30 minutes apart.** GitHub keeps only one run waiting behind a running one, and a newer waiting run replaces it, so close start times could silently skip a run. Sites that share a time go into one run.
- A switched-off site keeps its times. Started by hand ("Run workflow" with no sites listed), every switched-on site runs; a switched-off site exits straight away.

## Troubleshooting

Scraper health shows "The scheduler couldn't start the … run" with GitHub's reply. The log is in `public.scraper_dispatches`; the database job's own history is in `cron.job_run_details`.

| Error | Cause | Fix |
|---|---|---|
| `No GitHub token: add the Vault secret…` | Step 2 not done, or the secret has another name | Create it with the exact name `github_scraper_token` |
| `HTTP 401` / `Bad credentials` | Token pasted wrong, expired or deleted | Replace the secret (below) |
| `HTTP 403` | Token lacks **Actions: Read and write** | Edit the token on GitHub → Repository permissions → Actions |
| `HTTP 404` | Token has no access to `CedRaf/jobtracker`, or the repo or workflow was renamed | Edit the token's repository access. If renamed, update the URL in `public.dispatch_scrapers` with a new migration |
| `HTTP 422` | The workflow has no `sources` input on `main`, or lost `workflow_dispatch` | Check the `on:` section of `scraper.yml` on `main` |
| No rows at all | The cron job isn't scheduled | `select * from cron.job;` should list `dispatch-scrapers` |

## A new token, or replacing an expired one

1. GitHub → Settings → Developer settings → **Fine-grained tokens** → **Generate new token** (or open the old one → **Regenerate token**).
   - **Repository access:** only `CedRaf/jobtracker`. **Permissions:** **Actions → Read and write**; nothing else.
   - It can only start, cancel or view this repo's workflow runs. Note the expiry date; GitHub emails you before it expires.
2. Replace the secret in the SQL Editor:
   ```sql
   select vault.update_secret(
     (select id from vault.secrets where name = 'github_scraper_token'),
     'github_pat_NEW_TOKEN_HERE');
   ```
3. Test with `select public.dispatch_scrapers(array['himalayas']);` as in Step 3.

If a token leaks, delete it on GitHub (Fine-grained tokens → Delete); it stops working immediately.

## Pausing

- **Everything:** switch every site off on the Schedule tab. Supabase pauses free projects after a week without activity, and opening the dashboard counts, so visit at least once a week while scraping is off.
- **The database job itself:** `select cron.unschedule('dispatch-scrapers');` (undo by re-running the `cron.schedule(...)` line from the migration).
