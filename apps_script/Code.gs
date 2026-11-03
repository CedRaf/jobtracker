/**
 * JobTracker scraper timer (Google Apps Script).
 *
 * Starts the GitHub Actions scraper workflow at fixed hours, Manila time.
 * Setup: paste this file into Extensions > Apps Script, add the GITHUB_TOKEN
 * script property (TOKEN_SETUP.md), then run installScraperTimers once.
 *
 * The Google Sheet output, its web app (doPost) and the Sheet-based Gmail
 * drafts were retired on 2026-11-03: jobs go to Supabase and drafts are made
 * from the dashboard. The Sheet itself is kept as an archive.
 */

// ===== Scraper timer (starts the GitHub Actions workflow) ===================
//
// Google's time triggers are far more punctual than GitHub's cron, so this
// presses the workflow's "Run workflow" button at the hours below.
// Needs the GITHUB_TOKEN script property; see TOKEN_SETUP.md.

const GITHUB_REPO = 'CedRaf/jobtracker';  // owner/repo of the scraper workflow
const GITHUB_WORKFLOW = 'scraper.yml';
const GITHUB_BRANCH = 'main';
const SCRAPER_HOURS = [11, 15];   // 11 AM and 3 PM, Manila time
const SCRAPER_TIMEZONE = 'Asia/Manila';

/** Run once: creates the daily timers (replaces any existing ones). */
function installScraperTimers() {
  removeScraperTimers();
  SCRAPER_HOURS.forEach(hour => {
    ScriptApp.newTrigger('startScraper').timeBased()
      .everyDays(1).atHour(hour).nearMinute(0).inTimezone(SCRAPER_TIMEZONE).create();
  });
  Logger.log('Scraper timers set for ' + SCRAPER_HOURS.join(':00, ') + ':00 ' + SCRAPER_TIMEZONE +
    ' (Google runs them within about 15 minutes of that time).');
}

/** Stops the timers created by installScraperTimers(). */
function removeScraperTimers() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'startScraper')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

/** Starts the scraper workflow on GitHub. Called by the timers; can be run by hand to test. */
function startScraper() {
  const res = githubRequest_('post',
    `/repos/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW}/dispatches`,
    { ref: GITHUB_BRANCH });
  Logger.log('Scraper started on GitHub (HTTP ' + res.getResponseCode() + ').');
}

/** Checks the token can see the workflow, without starting a run. */
function checkGitHubToken() {
  const res = githubRequest_('get', `/repos/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW}`);
  const wf = JSON.parse(res.getContentText());
  Logger.log('Token OK. Workflow "' + wf.name + '" is ' + wf.state + '.');
}

function githubRequest_(method, path, body) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('Script property GITHUB_TOKEN is missing. See TOKEN_SETUP.md.');
  const options = {
    method: method,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    muteHttpExceptions: true,
  };
  if (body) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }
  const res = UrlFetchApp.fetch('https://api.github.com' + path, options);
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    const hints = {
      401: 'token is wrong or expired',
      403: 'token lacks the "Actions: Read and write" permission',
      404: 'token has no access to ' + GITHUB_REPO + ', or the repo/workflow name is wrong',
      422: 'branch "' + GITHUB_BRANCH + '" not found or workflow has no workflow_dispatch',
    };
    throw new Error('GitHub returned ' + code + (hints[code] ? ' (' + hints[code] + ')' : '') +
      ': ' + res.getContentText().slice(0, 300));
  }
  return res;
}
