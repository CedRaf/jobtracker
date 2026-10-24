/**
 * JobStreet scraper: Google Sheets side (Apps Script web app).
 *
 * What it does:
 *   1. doPost: receives scraped jobs from the Python scripts, adds only jobs
 *      whose id is not already in the sheet, and never touches existing rows.
 *      JobStreet goes to Jobs/Filtered, LinkedIn to LinkedIn/LinkedIn Filtered.
 *   2. handleEdit: when you set a row's "send_email" to "Yes" (Jobs or
 *      LinkedIn tab), it creates a
 *      Gmail DRAFT (never sends) addressed to that row's "email". If "email"
 *      is blank, the draft has no recipient and you fill it in in Gmail.
 *   3. startScraper: daily timers (11 AM / 3 PM Manila) that start the GitHub
 *      Actions scraper workflow. Setup: TOKEN_SETUP.md.
 *
 * One-time setup:
 *   1. Paste this file into Extensions > Apps Script (replace the default code).
 *   2. Fill in RESUME_FILE_ID below (optional), then Save.
 *   3. Select `setup` in the function dropdown and click Run. Approve the
 *      permissions. Copy the SECRET_TOKEN from the execution log.
 *   4. Deploy > New deployment > type "Web app"
 *        Execute as: Me    Who has access: Anyone
 *      Copy the web app URL. The URL and token go in the Python config.
 *   5. To update this code later: Deploy > Manage deployments > Edit (pencil)
 *      > Version: New version. This keeps the same URL.
 */

// ===== Settings ============================================================

const JOBS_SHEET = 'Jobs';
const FILTERED_SHEET = 'Filtered';
const LINKEDIN_SHEET = 'LinkedIn';
const LINKEDIN_FILTERED_SHEET = 'LinkedIn Filtered';

// Column order for a fresh sheet. If Python sends a field that isn't a column
// yet, it is added as a new column at the end automatically.
const JOB_COLUMNS = [
  'id', 'first_seen', 'search_term', 'title', 'company', 'location',
  'work_arrangement', 'work_type', 'salary_text', 'posted',
  'apply_type', 'apply_link', 'match_score', 'matched_skills', 'missing_skills', 'flags',
  'email', 'email_source', 'url',
];
// Columns you edit by hand. New rows get status "New"; nothing else is written.
const USER_COLUMNS = ['status', 'notes', 'send_email', 'draft_created'];
const FILTERED_COLUMNS = [
  'id', 'first_seen', 'search_term', 'title', 'company', 'location',
  'work_arrangement', 'reason', 'url',
];
const STATUS_OPTIONS = ['New', 'Applied', 'Emailed', 'Interview', 'Rejected', 'Skip'];

// Longest text written to a cell (Sheets' hard limit is 50,000).
const MAX_CELL_CHARS = 5000;

// ----- Email drafts --------------------------------------------------------

// Google Drive file ID of your resume PDF, to attach to every draft.
// Upload resume.pdf to Drive, open it, and copy the ID from the URL:
// https://drive.google.com/file/d/<THIS PART>/view   Leave '' for no attachment.
const RESUME_FILE_ID = '';

// Personal details live in Script Properties (Project Settings > Script
// Properties), not in this file:
//   SENDER_NAME       your name as shown in the From field
//   SUBJECT_TEMPLATE  e.g. "Inquiry: {title} Position - Your Name"
//   BODY_TEMPLATE     the full email body (multi-line is fine)
// Placeholders: {title}, {at_company} (" at Company" or blank), and any job column.
// The defaults below are used when a property is missing.
const DEFAULT_SUBJECT_TEMPLATE = 'Inquiry: {title} Position';
const DEFAULT_BODY_TEMPLATE = [
  'Dear Hiring Team,',
  '',
  'I am writing to ask whether the {title} position{at_company} is still open. ' +
    'If it is, I would like to express my interest in applying.',
  '',
  'I have attached my CV for your review.',
  '',
  'Thank you for your time and consideration.',
].join('\n');

function emailSettings_() {
  const props = PropertiesService.getScriptProperties();
  return {
    senderName: props.getProperty('SENDER_NAME') || '',
    subject: props.getProperty('SUBJECT_TEMPLATE') || DEFAULT_SUBJECT_TEMPLATE,
    body: props.getProperty('BODY_TEMPLATE') || DEFAULT_BODY_TEMPLATE,
  };
}

// ===== Setup (run once from the editor) ====================================

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [JOBS_SHEET, LINKEDIN_SHEET].forEach(name => {
    const jobs = getOrCreateSheet_(ss, name, JOB_COLUMNS.concat(USER_COLUMNS));
    applyValidation_(jobs, 2, jobs.getMaxRows() - 1);
  });
  getOrCreateSheet_(ss, FILTERED_SHEET, FILTERED_COLUMNS);
  getOrCreateSheet_(ss, LINKEDIN_FILTERED_SHEET, FILTERED_COLUMNS);

  const props = PropertiesService.getScriptProperties();
  props.setProperty('SHEET_ID', ss.getId());
  let token = props.getProperty('SECRET_TOKEN');
  if (!token) {
    token = Utilities.getUuid();
    props.setProperty('SECRET_TOKEN', token);
  }

  // Installable trigger: a simple onEdit() isn't allowed to use Gmail.
  const hasTrigger = ScriptApp.getProjectTriggers()
    .some(t => t.getHandlerFunction() === 'handleEdit');
  if (!hasTrigger) {
    ScriptApp.newTrigger('handleEdit').forSpreadsheet(ss).onEdit().create();
  }

  Logger.log('Setup complete. SECRET_TOKEN = ' + token);
}

// ===== Which Gmail gets the drafts =========================================
//
// Drafts are created in the Gmail of whoever INSTALLED the edit trigger, not
// the sheet owner. To send drafts to another account (e.g. the sheet is owned
// by account A, drafts should go to account B):
//   1. As A: run removeDraftTrigger()  (otherwise both accounts get drafts)
//   2. Share the sheet with B as Editor.
//   3. As B: open the sheet > Extensions > Apps Script > run installDraftTrigger()
//      and approve the permissions.
//   4. Make sure B can open the resume file (RESUME_FILE_ID).

/** Makes the account running this function the one that receives drafts. */
function installDraftTrigger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mine = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'handleEdit');
  if (!mine) ScriptApp.newTrigger('handleEdit').forSpreadsheet(ss).onEdit().create();
  if (RESUME_FILE_ID) DriveApp.getFileById(RESUME_FILE_ID).getName();  // fails early if no access
  Logger.log('Drafts will be created in: ' + Session.getEffectiveUser().getEmail());
}

/** Stops the account running this function from receiving drafts. */
function removeDraftTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'handleEdit')
    .forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log('Removed draft trigger for: ' + Session.getEffectiveUser().getEmail());
}

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

// ===== Web app =============================================================

/**
 * Expects JSON: { "token": "...", "jobs": [ {...}, ... ], "filtered": [ {...}, ... ],
 *                 "linkedin_jobs": [...], "linkedin_filtered": [...] }  (all lists optional)
 * Each job needs an "id". Returns counts of added and skipped (duplicate) rows.
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const body = JSON.parse(e.postData.contents);
    const token = PropertiesService.getScriptProperties().getProperty('SECRET_TOKEN');
    if (!token || body.token !== token) {
      return json_({ ok: false, error: 'unauthorized' });
    }

    lock.waitLock(30000);
    const ss = SpreadsheetApp.openById(
      PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
    const now = new Date();
    const jobs = appendNew_(ss.getSheetByName(JOBS_SHEET), body.jobs || [], now, true);
    const filtered = appendNew_(ss.getSheetByName(FILTERED_SHEET), body.filtered || [], now, false);
    // LinkedIn tabs are created on first use, so redeploying is enough (no need to re-run setup).
    const liJobs = appendNew_(
      getOrCreateSheet_(ss, LINKEDIN_SHEET, JOB_COLUMNS.concat(USER_COLUMNS)),
      body.linkedin_jobs || [], now, true);
    const liFiltered = appendNew_(
      getOrCreateSheet_(ss, LINKEDIN_FILTERED_SHEET, FILTERED_COLUMNS),
      body.linkedin_filtered || [], now, false);

    return json_({
      ok: true,
      added: jobs.added,
      skipped: jobs.skipped,
      filtered_added: filtered.added,
      filtered_skipped: filtered.skipped,
      linkedin_added: liJobs.added,
      linkedin_skipped: liJobs.skipped,
      linkedin_filtered_added: liFiltered.added,
      linkedin_filtered_skipped: liFiltered.skipped,
    });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** Health check: open the web app URL in a browser to confirm it's deployed. */
function doGet() {
  return json_({ ok: true, service: 'jobstreet-sheet' });
}

// ===== "Yes" -> Gmail draft ================================================

function handleEdit(e) {
  const sheet = e.range.getSheet();
  if (sheet.getName() !== JOBS_SHEET && sheet.getName() !== LINKEDIN_SHEET) return;

  const headers = getHeaders_(sheet);
  const col = name => headers.indexOf(name);
  const sendCol = col('send_email') + 1;
  if (!sendCol || e.range.getColumn() > sendCol || e.range.getLastColumn() < sendCol) return;

  // Loop so pasting "Yes" into several rows at once works too.
  for (let row = Math.max(2, e.range.getRow()); row <= e.range.getLastRow(); row++) {
    const values = sheet.getRange(row, 1, 1, headers.length).getValues()[0];
    if (String(values[col('send_email')]).trim().toLowerCase() !== 'yes') continue;
    // A date means a draft already exists; text (an old error) means retry.
    if (values[col('draft_created')] instanceof Date) continue;

    const job = {};
    headers.forEach((h, i) => { job[h] = values[i]; });
    const target = sheet.getRange(row, col('draft_created') + 1);

    try {
      createDraft_(job);
      target.setValue(new Date());
      // Blank email still gets a draft; you fill in "To" in Gmail.
      target.setNote(String(job.email || '').trim() ? '' : 'Draft has no recipient. Add the email in Gmail.');
    } catch (err) {
      target.setValue('Error: ' + err.message);
    }
  }
}

function createDraft_(job) {
  const company = String(job.company || '').trim();
  const hasCompany = company && !/private advertiser|confidential/i.test(company);
  const vars = Object.assign({}, job, {
    at_company: hasCompany ? ' at ' + company : '',
  });

  const email = emailSettings_();
  const options = {};
  if (email.senderName) options.name = email.senderName;
  if (RESUME_FILE_ID) {
    options.attachments = [DriveApp.getFileById(RESUME_FILE_ID).getBlob()];
  }
  GmailApp.createDraft(String(job.email || '').trim(), fill_(email.subject, vars),
    fill_(email.body, vars), options);
}

// ===== Helpers =============================================================

function appendNew_(sheet, records, now, isJobs) {
  if (!sheet) throw new Error('Sheet tab missing. Run setup() first.');
  if (!records.length) return { added: 0, skipped: 0 };

  // Add a column for any field Python sends that isn't in the sheet yet.
  let headers = getHeaders_(sheet);
  const extra = [];
  records.forEach(r => Object.keys(r).forEach(k => {
    if (headers.indexOf(k) === -1 && extra.indexOf(k) === -1) extra.push(k);
  }));
  if (extra.length) {
    ensureSize_(sheet, 0, headers.length + extra.length);
    sheet.getRange(1, headers.length + 1, 1, extra.length)
      .setValues([extra]).setFontWeight('bold');
    headers = headers.concat(extra);
  }

  const idCol = headers.indexOf('id') + 1;
  const lastRow = sheet.getLastRow();
  const seen = new Set();
  if (lastRow > 1) {
    sheet.getRange(2, idCol, lastRow - 1, 1).getValues()
      .forEach(r => seen.add(String(r[0])));
  }

  const rows = [];
  let skipped = 0;
  records.forEach(r => {
    const id = String(r.id == null ? '' : r.id).trim();
    if (!id || seen.has(id)) { skipped++; return; }
    seen.add(id);
    const rec = Object.assign({ first_seen: now }, r);
    if (isJobs && !rec.status) rec.status = 'New';
    rows.push(headers.map(h => cell_(rec[h])));
  });

  if (rows.length) {
    ensureSize_(sheet, lastRow + rows.length, headers.length);
    sheet.getRange(lastRow + 1, 1, rows.length, headers.length).setValues(rows);
    if (isJobs) applyValidation_(sheet, lastRow + 1, rows.length);
  }
  return { added: rows.length, skipped: skipped };
}

function cell_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date || typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) v = v.join(', ');
  else if (typeof v === 'object') v = JSON.stringify(v);
  let s = String(v).slice(0, MAX_CELL_CHARS);
  // Scraped text starting with = + - @ would run as a formula; force plain text.
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function getOrCreateSheet_(ss, name, columns) {
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    ensureSize_(sheet, 1, columns.length);
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getHeaders_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (!lastCol) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
}

function applyValidation_(sheet, startRow, numRows) {
  if (numRows < 1) return;
  const headers = getHeaders_(sheet);
  const lists = { status: STATUS_OPTIONS, send_email: ['Yes', 'No'] };
  Object.keys(lists).forEach(name => {
    const col = headers.indexOf(name) + 1;
    if (!col) return;
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(lists[name], true).setAllowInvalid(false).build();
    sheet.getRange(startRow, col, numRows, 1).setDataValidation(rule);
  });
}

/** Grow the grid so rows/cols up to the given size exist (getRange can't exceed it). */
function ensureSize_(sheet, rows, cols) {
  if (rows > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows());
  if (cols > sheet.getMaxColumns()) sheet.insertColumnsAfter(sheet.getMaxColumns(), cols - sheet.getMaxColumns());
}

function fill_(template, vars) {
  return template.replace(/\{(\w+)\}/g, (m, key) => (vars[key] == null ? '' : String(vars[key])));
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== Manual test (run from the editor after setup) =======================

/** Adds a fake row to Jobs. Delete it afterwards. */
function testPost() {
  const token = PropertiesService.getScriptProperties().getProperty('SECRET_TOKEN');
  const res = doPost({ postData: { contents: JSON.stringify({
    token: token,
    jobs: [{
      id: 'TEST-1', search_term: 'junior developer', title: 'Junior React Developer',
      company: 'Test Company', location: 'Cebu City, Cebu', work_arrangement: 'Hybrid',
      matched_skills: 'React, TypeScript', match_score: 5,
      email: Session.getActiveUser().getEmail(), email_source: 'test',
      url: 'https://ph.jobstreet.com/',
    }],
  }) } });
  Logger.log(res.getContent());
}
