# State machine redesign plan

Drafted 2026-11-11 · for review

Every implicit state machine in jobtracker becomes explicit. Each one gets a stored state, a database function that is the only way to change it, and a written list of allowed moves. This fixes the 15 routes you marked unintended in the audit. Logging an application at a later stage keeps working as it does today, as you decided.

## Decisions and status (2026-11-11)

Settled in review. Each rollout is on its own branch and committed by you.

| Rollout | Branch | Status |
| --- | --- | --- |
| 1. Job application | `state-machine/1-job-application` | Committed to `main` |
| 2. Listing lifecycle (Machine 3) | `state-machine/2-listing-lifecycle` | Built, not committed |
| 3. Scrape run (Machine 2) | — | Not started |
| 4. Scheduler dispatch (Machine 4) | — | Not started |

- **Emailed** merges into Applied (the channel records email). Jobs already Emailed keep that status as legacy and move on like Applied ones; nothing new becomes Emailed.
- **Withdrawn** is added for pulling out after applying.
- **Expired** replaces `closed_at` (3.2): a job moves from New to Expired after **15 days** with no action, or (rollout 2) sooner, when the scraper sees the posting closed. Expired jobs are hidden by default and can still go to Applied or Skip. Only jobs found (or brought back to New) after rollout 1's migration runs expire; the existing New backlog is left alone.
- **Undo** reverts a job's latest change at any time, as long as nothing has changed since; the toast is a shortcut to it. **Correct status** handles decisions made earlier: it allows any status and is logged as a correction, which the analytics count instead of the status it replaced.
- **1.8:** option A. The first-response rule judges changes only, so logging an application at a later stage keeps working as before.
- **1.9:** existing data is left alone. No backfill, and the new rules only judge rows as they change.
- **Rollout 2 closed postings:** each run re-checks its site's jobs in New aged 3 to 15 days and moves closed ones to Expired. Like the age expiry, only jobs found after rollout 1 count. Himalayas has no details endpoint, so there a job counts as closed only when this run's results list it with a past expiry date.
- **To revisit later: reopening a rejection.** For now Rejected is final, and Correct status is the way out (for example, when a company comes back months later). Decide whether Rejected → Applied/Interview should be an allowed move.

## How to review

Every proposed change ends with two things for you to fill in:

- **Your call:** put an `x` in one box: `[x] Agree`, `[x] Change it` or `[x] Discuss`.
- **Your notes:** write under the line, in plain words or as the flow you think is right. Arrows like `new -> applied -> interview` are fine.

You can also edit the proposal text itself. Tell me when you're done and I'll read the file back and revise.

---

## Design rules

These four rules apply to every machine below.

1. **One stored state.** Each machine has a single enum column for its state. Other fields are details of that state. They never decide what the state is.
2. **One way to change it.** A database function performs every transition. It checks the move is allowed, updates all related fields in the same statement, and writes history. The dashboard and the scraper call that function and can't update the state column directly.
3. **Allowed moves are written down.** They live in one table or function, next to the tests that cover them, not spread across UI handlers.
4. **The database rules out impossible combinations.** Check constraints stop fields from contradicting the state. For example, a job can't be Interview while `applied_at` is empty.

**Your call:** [ ] Agree  [ ] Change it  [ ] Discuss

**Your notes:**

&nbsp;

---

## Machine 1: Job application

### 1.0 Proposed statuses

| Status | Meaning | Change from today |
| --- | --- | --- |
| `new` | Found by the scraper, not reviewed yet | Same |
| `applied` | You applied by any channel. `channel` records how (job board, email, referral…) | **Emailed is merged into this.** Existing Emailed jobs become Applied with `channel = direct_message` |
| `exam` | Take-home or online test | Same |
| `interview` | Interviewing | Same |
| `offer` | Offer received | Same |
| `rejected` | They said no | Can only be reached after applying |
| `skip` | You decided not to apply | Can only be reached from New |
| `withdrawn` | You pulled out after applying | **New.** Today this case is lumped into Skip, and `dropOff()` counts it as "other" |

**Your call:** [x] Agree  [ ] Change it  [ ] Discuss

**Your notes:** We can add an `expired` state for job listings that are still marked `new` or `seen` after 15 days or whatever duration of time you think is right? Generally I don't mark every job listing as `skip` because there are simply too many listings that are fetched across all 3 job boards for me to mark every single one. I generally only mark `skip` the ones I manually review. 

&nbsp;

### 1.1 Allowed moves

Any move not in this table is refused by the database. Mistakes are fixed with Undo (1.2), not by moving backwards. Edit this table directly if you want a different flow.

| From | Allowed to |
| --- | --- |
| `new` | `applied`, `skip` |
| `applied` | `exam`, `interview`, `offer`, `rejected`, `withdrawn` |
| `exam` | `interview`, `offer`, `rejected`, `withdrawn` |
| `interview` | `offer`, `rejected`, `withdrawn` |
| `offer` | `rejected` (offer rescinded), `withdrawn` (you declined) |
| `rejected` | nothing (final) |
| `withdrawn` | nothing (final) |
| `skip` | `new` (you changed your mind; clears `skip_reason`) |

Each move does the following, in the same database statement:

- **To `applied`:** sets `applied_at` (now, or the date you pick) and `channel` (asked for in the UI; `job_board` is the default for scraped jobs).
- **To `exam`, `interview`, `offer` or `rejected` for the first time:** sets `first_response_at` to now.
- **To `skip`:** saves `skip_reason` in the same call.
- **`skip` to `new`:** clears `skip_reason`.
- **Every move:** writes a `status_history` row, including a snapshot of the fields as they were before the move (used by Undo).

The board shows drop targets only for allowed moves, and the status select lists only allowed options.

**Your call:** [x] Agree  [ ] Change it  [ ] Discuss

**Your notes:**

&nbsp;

### 1.2 Route: Undo doesn't undo

**Today:** Undo is a second status change. The mistaken status stays in `status_history` and the analytics count it forever, so a misclick into Offer means Analytics reports an Offer.

**Proposed:** Undo calls `revert_status_change(history_id)`. That function restores the snapshot stored on the history row (status, `applied_at`, `first_response_at`, `channel`, `skip_reason`) and marks the row `reverted`. The analytics ignore reverted rows. Only the latest change on a job can be reverted, and only if nothing has changed since.

**Your call:** [x] Agree  [ ] Change it  [ ] Discuss

**Your notes:**

&nbsp;

### 1.3 Route: New → Rejected counts as a reply

**Today:** People use Rejected to mean "not for me". The database treats it as no response, while the analytics count it as one.

**Proposed:** The move isn't allowed. New only goes to Applied or Skip. Since Rejected can then only follow an application, "rejected = response" is always true and both layers agree.

**Your call:** [x] Agree  [ ] Change it  [ ] Discuss

**Your notes:**

&nbsp;

### 1.4 Route: Moving back to New keeps the application

**Today:** Going back to New clears nothing. The job sits in the New queue but still counts as an application.

**Proposed:** The only move into New is Skip → New. Every other mistake is fixed with Undo, which restores the earlier field values exactly.

**Your call:** [x] Agree  [ ] Change it  [ ] Discuss

**Your notes:**

&nbsp;

### 1.5 Route: Opening a Gmail draft counts as emailing

**Today:** "Draft in Gmail" sets the status to Emailed even if you never send. From Applied, the job ends up with status Emailed but channel Job board.

**Proposed:** "Draft in Gmail" only records `email_drafted_at`. After drafting, the drawer shows a **Mark as applied by email** button, which moves the job to Applied with `channel = direct_message`. Status and channel can no longer contradict each other, because the status doesn't encode the channel.

**Your call:** [x] Agree  [ ] Change it  [ ] Discuss

**Your notes:**

&nbsp;

### 1.6 Route: skip_reason outlives the skip

**Today:** The reason survives leaving Skip, it's saved in a separate request from the status change, and Undo leaves it behind.

**Proposed:** The reason is a parameter of the move to Skip, so both are saved together or neither is. Skip → New clears it, and Undo restores whatever it was before. Earlier reasons stay readable in the history.

**Your call:** [x] Agree  [ ] Change it  [ ] Discuss

**Your notes:**

&nbsp;

### 1.7 Route: Clearing a date makes the trigger refill it wrongly

**Today:** You can clear `applied_at` or `first_response_at` while the status says you applied or heard back. The next status change then stamps a wrong date.

**Proposed:** Two check constraints:

- If the status is Applied or later (including Withdrawn), `applied_at` can't be empty.
- If the job has reached Exam, Interview, Offer or Rejected, `first_response_at` can't be empty.

The drawer still lets you **change** either date. It no longer lets you clear one that the status requires.

**Your call:** [x] Agree  [ ] Change it  [ ] Discuss

**Your notes:**

&nbsp;

### 1.8 Kept as is: logging an application at a later stage

The log form keeps leaving `first_response_at` empty when you log a job at Exam or later. **Conflict with 1.7:** the second constraint would refuse that insert. Options:

- **A.** The constraint applies to status changes only and skips manual inserts.
- **B.** The log form gets an optional "First response on" date, and the constraint allows it to stay empty only for manual jobs.

**Your call:** [x] A  [ ] B  [ ] Discuss

**Your notes:**

&nbsp;

### 1.9 Existing data

- Emailed → Applied with `channel = direct_message` (and keep any channel already set by hand).
- Old history rows have no snapshot, so they can't be reverted. Misclicks that already happened can't be detected automatically. I can produce a list of jobs whose history moves backwards (for example offer → applied) for you to check by hand.
- Jobs whose current status breaks a new constraint (for example Interview with no `applied_at`) get listed before the constraint is added, not silently changed.

**Your call:** [ ] Agree  [ ] Change it  [x] Discuss

**Your notes:** Just leave the existing data alone, just use the new data moving forward

&nbsp;

---

## Machine 2: Scrape run

### 2.0 Proposed states

`scrape_runs` gets a stored `status` column: `running`, `ok`, `failed`, `interrupted`, `skipped`. The dashboard reads that column, and `runState()` stops guessing from timestamps.

**Your call:** [x] Agree  [ ] Change it  [ ] Discuss

**Your notes:**

&nbsp;

### 2.1 Route: A successful run can show as interrupted

**Today:** If the final update to `scrape_runs` fails, the error is swallowed and the row never closes.

**Proposed:** The final update is retried with backoff. A last workflow step runs with `if: always()` and closes any row for this GitHub run that is still `running`: `interrupted` if the job was cancelled or timed out, `failed` otherwise.

**Your call:** [x] Agree  [ ] Change it  [ ] Discuss

**Your notes:**

&nbsp;

### 2.2 Route: Two timeouts that disagree

**Today:** LinkedIn's step times out at 30 minutes, but the dashboard waits 60 minutes before calling a run interrupted.

**Proposed:** The `always()` step from 2.1 closes killed runs right away. The dashboard's timeout drops to 35 minutes and only covers the rare case where the closing step itself never ran.

**Your call:** [x] Agree  [ ] Change it  [ ] Discuss

**Your notes:**

&nbsp;

### 2.3 Route: "No row" means three different things

**Today:** A switched-off site, a dry run and a failed start insert all leave no row, and the dashboard flags the source as stale.

**Proposed:** A switched-off site writes a `skipped` row, and the stale warning ignores sources that are switched off in settings. Dry runs still write nothing. A failed start insert is retried like the final update.

**Your call:** [x] Agree  [ ] Change it  [ ] Discuss

**Your notes:**

&nbsp;

### 2.4 Route: Failed after the jobs were saved

**Today:** An error after delivery (for example while saving the seen list) marks the run `failed`, even though the jobs reached the database.

**Proposed:** Once delivery succeeds, the run is `ok`. Any later error goes in a new `warning` column, shown on the dashboard as "ok, with a warning".

**Your call:** [x] Agree  [ ] Change it  [ ] Discuss

**Your notes:**

&nbsp;

---

## Machine 3: Listing lifecycle

### 3.0 Proposed source of truth

**Today:** "Seen" lives in a JSON file kept in the GitHub Actions cache, and the outcome lives in whichever of two tables holds the listing.

**Proposed (option A, recommended first):** At the start of a run, the scraper loads the seen list from the database: every key in `jobs` and `filtered_jobs`, plus a new small `expired_listings` table. The cache file stays only as a speed-up and is no longer trusted. Nothing ages out.

**Option B (larger):** One `listings` table with a `decision` column (`kept`, `filtered`, `expired`), and `jobs` / `filtered_jobs` become views of it. This is cleaner, but it touches every query on the dashboard.

**Your call:** [x] A  [ ] B  [ ] Discuss

**Your notes:**

&nbsp;

### 3.1 Route: A listing can end up in both jobs and filtered_jobs

**Proposed:** Fixed by 3.0, because a listing in either table is never evaluated again. A database check (a trigger on insert) refuses a key that already exists in the other table, as a backstop. Existing duplicates get listed for you to resolve.

**Your call:** [x] Agree  [ ] Change it  [ ] Discuss

**Your notes:**

&nbsp;

### 3.2 Route: There is no expired state for saved jobs

**Today:** A job already in `jobs` stays New after the posting closes.

**Proposed:** Add `closed_at` to `jobs`. Each run re-checks jobs still in `new` that are older than 3 days, using the site's details endpoint, and sets `closed_at` when the posting has expired. Your status doesn't change. The board shows a "Closed" tag and hides closed New jobs by default.

**Your call:** [ ] Agree  [ ] Change it  [x] Discuss

**Your notes:** Refer to the earlier comments found under section 1 

&nbsp;

### 3.3 Route: Repost detection forgets too

**Proposed:** Repost keys come from `jobs.repost_key`, which is already stored and indexed, instead of the cache file. Nothing ages out.

**Your call:** [x] Agree  [ ] Change it  [ ] Discuss

**Your notes:**

&nbsp;

---

## Machine 4: Scheduler dispatch

### 4.0 Proposed states

`scraper_dispatches` gets a stored `status`: `no_token`, `pending`, `accepted`, `failed`, `lost`.

**Your call:** [x] Agree  [ ] Change it  [ ] Discuss

**Your notes:**

&nbsp;

### 4.1 Route: A dispatch can stay pending permanently

**Proposed:** `record_dispatch_replies()` also marks any dispatch still `pending` after 6 hours as `lost`, since pg_net will have discarded the reply by then.

**Your call:** [x] Agree  [ ] Change it  [ ] Discuss

**Your notes:**

&nbsp;

### 4.2 Route: Accepted doesn't mean it ran

**Proposed:** The dispatch id is passed to the workflow as an input, and the scraper stores it on each `scrape_runs` row. The dashboard can then flag "accepted, but no run started after 30 minutes".

**Your call:** [x] Agree  [ ] Change it  [ ] Discuss

**Your notes:**

&nbsp;

---

## Rollout order

Each step is its own migration plus code and tests, shipped on its own.

1. **Machine 1.** It skews your analytics today, and it's the largest change. The transition function, constraints and Undo land first. The UI (allowed drop targets, the Mark as applied button) follows.
2. **Machine 3.** It's a data integrity problem that gets worse every time the cache is evicted.
3. **Machine 2.** It only affects how runs are displayed, not data.
4. **Machine 4.** It's the smallest change and the least urgent.

**Your call:** [x] Agree  [ ] Change it  [ ] Discuss

**Your notes:** These changes should follow this incremental rollout order. Do not make any commits, i'll be the one to commit these files. Work in a separate branch as well for each Rollout order.

&nbsp;

## Open questions

- [ We can merge emailed into applied ] Merge Emailed into Applied (1.0), or keep Emailed as its own status?
- [ Add Withdrawn ] Add Withdrawn (1.0), or keep using Skip for "pulled out after applying"?
- [ Leave as rejected for now, just make a note so that I can come back to this logic-flow in the future ] Should Rejected ever reopen (for example, the company comes back months later)? If so, back to which status?
- [ Undos should not only last 6 seconds, maybe a bigger time window and another edit option possibly for decision changes down the line ] Undo only from the 6-second toast, or any time for a job's latest change?
- [ Yes, hide closed postings ] Hide closed postings from the board by default (3.2)?

**Your notes:**

&nbsp;
