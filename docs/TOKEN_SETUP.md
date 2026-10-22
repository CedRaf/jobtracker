# Token setup for `Code.gs`

This guide sets up the **GitHub token** the Apps Script timer needs to start the scraper at 11 AM and 3 PM. It takes about 10 minutes.

## How it fits together

```
Apps Script timer (11:00 / 15:00 Manila)
   │  startScraper() sends a request with GITHUB_TOKEN
   ▼
GitHub Actions "JobStreet + LinkedIn scraper" (runs like pressing "Run workflow")
   │  sends SHEET_TOKEN with the results
   ▼
Apps Script web app (doPost) checks SECRET_TOKEN ──► writes rows to the sheet
```

## All the secrets in this project

| Name | Where it lives | What it's for | Status |
|---|---|---|---|
| `SECRET_TOKEN` | Apps Script → Project Settings → Script Properties | Only the scraper can add rows to the sheet | Done (created by `setup()`) |
| `SHEET_WEBAPP_URL`, `SHEET_TOKEN` | GitHub repo → Settings → Secrets and variables → Actions | The scraper on GitHub knows where to send jobs | Done |
| `RESUME_FILE_ID` | Top of `Code.gs` (a Drive file ID, not a secret) | Attaches your resume to drafts | Set it if you haven't |
| `SENDER_NAME`, `SUBJECT_TEMPLATE`, `BODY_TEMPLATE` | Apps Script → Project Settings → Script Properties (optional) | Your name and the email wording for drafts; generic defaults are used if missing | Set before using drafts |
| **`GITHUB_TOKEN`** | Apps Script → Project Settings → Script Properties | Lets the timer start the GitHub workflow | **This guide** |

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
   - **Repository access:** **Only select repositories** → pick **`CedRaf/jobtrack`**
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

You should now see both `SECRET_TOKEN` and `GITHUB_TOKEN`, plus `SHEET_ID`.

## Step 3: Update the code

1. In the editor, open `Code.gs`, replace everything with the latest `apps_script/Code.gs` from this project, and **Save** (Ctrl+S).
   - You don't need to redeploy the web app. The new functions aren't part of it.

## Step 4: Test the token (starts nothing)

1. In the function dropdown at the top of the editor, select **`checkGitHubToken`** → **Run**.
2. The first time, Google asks for a new permission, **"Connect to an external service"**. Click **Review permissions**, choose your account, then **Advanced → Go to (project) → Allow**.
3. The **Execution log** should say:
   ```
   Token OK. Workflow "JobStreet + LinkedIn scraper" is active.
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

## Step 7: Re-approve the draft trigger for the other account

Adding the GitHub feature gave `Code.gs` a new permission (external requests). Google may pause the **draft trigger** owned by the drafts account (if it differs from the sheet owner) until that account approves the updated permissions.

1. Sign in as the **drafts account**, open the sheet → **Extensions → Apps Script**.
2. Run **`installDraftTrigger`** once and approve the permissions. It won't create a duplicate trigger.
3. Test: set `send_email` to **Yes** on a row, and a draft should appear in that account's Gmail.

## Step 8: Push the workflow change

The workflow file no longer has its own `cron` schedule, so GitHub and Google won't both start runs. Commit and push:

```bash
git add .github/workflows/scraper.yml apps_script/Code.gs docs/TOKEN_SETUP.md
```

```bash
git commit -m "Start scraper from Apps Script timer instead of GitHub cron"
```

```bash
git push
```

---

## Troubleshooting

| Error in the Apps Script log | Cause | Fix |
|---|---|---|
| `Script property GITHUB_TOKEN is missing` | Step 2 not done, or a typo in the name | Add the property with the exact name `GITHUB_TOKEN` |
| `GitHub returned 401` | Token pasted wrong, expired or deleted | Generate a new token (Step 1) and replace the property value |
| `GitHub returned 403` | Actions permission isn't *Read and write* | Edit the token on GitHub → Actions → Read and write |
| `GitHub returned 404` | Token wasn't given access to `jobtrack`, or the repo was renamed | Edit the token → Repository access → add the repo. If renamed, update `GITHUB_REPO` in `Code.gs` |
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
