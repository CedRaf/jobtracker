# Token setup for `Code.gs`

This guide sets up the **GitHub token** the Apps Script timer needs to start the scraper at 11 AM and 3 PM. It takes about 10 minutes.

## How it fits together

```
Apps Script timer (11:00 / 15:00 Manila)
   │  startScraper() sends a request with GITHUB_TOKEN
   ▼
GitHub Actions scraper workflow (runs like pressing "Run workflow")
   │  writes jobs with SUPABASE_SECRET_KEY
   ▼
Supabase
```

The Google Sheet output, its web app and the Sheet-based Gmail drafts were retired on 2026-11-03 (see "Retiring the Sheet" at the end). `Code.gs` is now only the timer.

## The secrets the timer uses

| Name | Where it lives | What it's for |
|---|---|---|
| **`GITHUB_TOKEN`** | Apps Script → Project Settings → Script Properties | Lets the timer start the GitHub workflow (**this guide**) |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | GitHub repo → Settings → Secrets and variables → Actions | Lets the scraper write to Supabase (`DASHBOARD_SETUP.md`) |

> Never paste a token into `Code.gs` itself. `Code.gs` is in your GitHub repo, so anyone who can see the repo could read it. Script Properties stay inside Google.

---

## Step 1: Create the GitHub token

1. On github.com, click your profile picture (top right) → **Settings**.
2. In the left sidebar, scroll to the bottom → **Developer settings**.
3. **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
4. Fill in:
   - **Token name:** `jobstreet-scraper-timer`
   - **Description** (optional): `Apps Script timer starts the scraper workflow`
   - **Resource owner:** `CedRaf`
   - **Expiration:** choose the longest option offered (e.g. 1 year) and note the date. GitHub emails you before it expires.
   - **Repository access:** **Only select repositories** → pick **`CedRaf/jobtracker`**
5. Under **Permissions → Repository permissions**, find **Actions** and set it to **Read and write**.
   - Leave everything else at *No access*. GitHub adds **Metadata: Read-only** automatically; that's expected.
6. Click **Generate token**, then **copy the token** (starts with `github_pat_`).
   - **GitHub shows it only once.** If you lose it, generate a new one.

Why this is safe: this token can only start, cancel or view runs of **this one repo's** workflows. It can't read your code, change files or touch your other repos.

## Step 2: Store it in Apps Script

1. Open your Google Sheet → **Extensions → Apps Script**. Use the account that owns the sheet.
2. Click the **gear icon (Project Settings)** in the left sidebar.
3. Scroll to **Script Properties** → **Add script property**:
   - **Property:** `GITHUB_TOKEN`
   - **Value:** the `github_pat_...` token you copied
4. Click **Save script properties**.

## Step 3: Update the code

1. In the editor, open `Code.gs`, replace everything with the latest `apps_script/Code.gs` from this project, and **Save** (Ctrl+S).

## Step 4: Test the token (starts nothing)

1. In the function dropdown at the top of the editor, select **`checkGitHubToken`** → **Run**.
2. The first time, Google asks for a new permission, **"Connect to an external service"**. Click **Review permissions**, choose your account, then **Advanced → Go to (project) → Allow**.
3. The **Execution log** should say:
   ```
   Token OK. Workflow "JobStreet + LinkedIn + Himalayas scraper" is active.
   ```
   If you see an error instead, check the troubleshooting table below.

## Step 5: Turn on the timers

1. Select **`installScraperTimers`** → **Run**.
2. The log should say:
   ```
   Scraper timers set for 11:00, 15:00 Asia/Manila (Google runs them within about 15 minutes of that time).
   ```
3. Check it: click the **clock icon (Triggers)** in the left sidebar. You should see **two** `startScraper` triggers, *Time-based, Day timer*.

## Step 6: Test a real run (optional)

1. Select **`startScraper`** → **Run**. The log should say `Scraper started on GitHub (HTTP 204)`.
2. On GitHub → **Actions**, a new run appears within a few seconds, with the event **workflow_dispatch**. Its **Show trigger** step says who started it; that's the token's owner, `CedRaf`.

---

## Troubleshooting

| Error in the Apps Script log | Cause | Fix |
|---|---|---|
| `Script property GITHUB_TOKEN is missing` | Step 2 not done, or a typo in the name | Add the property with the exact name `GITHUB_TOKEN` |
| `GitHub returned 401` | Token pasted wrong, expired or deleted | Generate a new token (Step 1) and replace the property value |
| `GitHub returned 403` | Actions permission isn't *Read and write* | Edit the token on GitHub → Actions → Read and write |
| `GitHub returned 404` | Token wasn't given access to `jobtracker`, or the repo was renamed | Edit the token → Repository access → add the repo. If renamed, update `GITHUB_REPO` in `Code.gs` |
| `GitHub returned 422` | Branch isn't `main`, or the workflow lost `workflow_dispatch` | Check `GITHUB_BRANCH` in `Code.gs` and the `on:` section of `scraper.yml` |
| Timers never fire | Timers were removed, or the account that created them lost access | Run `installScraperTimers` again |

If a timer run fails, Google emails a **failure summary** to the account that created the timer.

## Yearly renewal (when the token expires)

1. GitHub → Settings → Developer settings → Fine-grained tokens → open `jobstreet-scraper-timer` → **Regenerate token**.
2. Copy the new token → Apps Script → Project Settings → Script Properties → edit `GITHUB_TOKEN` → Save.
3. Run `checkGitHubToken` to confirm. There's no code change and no need to reinstall the timers.

## Changing times or turning it off

- **Different times:** edit `SCRAPER_HOURS` in `Code.gs` (24-hour format, Manila time), save, and run `installScraperTimers` again.
- **Pause scraping:** run `removeScraperTimers`. You can still start runs by hand from GitHub's **Run workflow** button.
- **If a token leaks:** delete it on GitHub (Fine-grained tokens → Delete). It stops working immediately. Then make a new one.

## Retiring the Sheet (2026-11-03)

The scraper no longer writes to the Google Sheet. Do these **after** the change is merged to `main`; before that, `main` still writes to the Sheet and a run would fail without it.

1. **GitHub:** repo → Settings → Secrets and variables → Actions → delete `SHEET_WEBAPP_URL` and `SHEET_TOKEN`.
2. **Apps Script** (open the Sheet → Extensions → Apps Script):
   1. **Triggers** (clock icon): delete the `handleEdit` trigger(s), in every account that installed one. Keep the two `startScraper` ones.
   2. **Deploy → Manage deployments:** archive the web app deployment.
   3. Replace `Code.gs` with the latest `apps_script/Code.gs` (timer only) and save. The timers keep working; there's no need to reinstall them.
   4. **Project Settings → Script Properties:** delete `SECRET_TOKEN`, `SHEET_ID`, `SENDER_NAME`, `SUBJECT_TEMPLATE` and `BODY_TEMPLATE`. Keep `GITHUB_TOKEN`.
3. Keep the Sheet itself as an archive; nothing reads or writes it any more.
