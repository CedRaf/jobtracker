# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary:** one person, the owner — a junior developer in Cebu, Philippines, hunting for junior developer roles. They open the dashboard every day after the scraper runs (11 AM and 3 PM Manila time) to review new listings, change application statuses and check which filter rules dropped jobs.
- **Secondary:** recruiters and reviewers who see the public demo (`npm run dev:demo` / demo build) as a portfolio piece. They see the same UI with sample data. The design should look credible to them, but nothing is added only for them.

## Product Purpose

JobTracker turns a twice-daily scrape of JobStreet PH and LinkedIn into a personal application tracker. The scraper filters and flags listings with regex rules; the dashboard is where the owner decides what to apply to, records what happened (applied, emailed, interview, offer, rejected, skip) and spots rules that are too strict.

Success: the daily review of new listings is fast, nothing new is missed, status changes take one action, and over-strict rules are easy to see.

## Positioning

A tool built for one person's real job search, fed by their own scraper and rules, rather than a generic job board or CRM. The "filtered" view exists so the owner can audit their own rules, which no off-the-shelf tracker does.

## Operating Context

- Used about equally on a laptop and a phone. Desktop gets the dense table; the phone must support quick reviews and status changes, not just viewing.
- Sessions are short and repeated: scan what is new since the last visit, triage, update a few statuses, maybe read one description in full.
- Data comes from Supabase (Postgres with row-level security). Email + password login for the owner; demo mode needs no login.

## Capabilities and Constraints

- Views: Jobs (JobStreet / LinkedIn tabs, summary cards that act as filters, filter bar, table, detail drawer) and Filtered (dropped jobs grouped by rule).
- Editable fields on a job: `status`, `skip_reason`, `notes`, `email_drafted_at` only. Everything else is scraper-owned and read-only.
- The match score is deliberately hidden (`SHOW_MATCH_SCORE = false`) and must stay hidden.
- Flag categories in the UI must match the flags `scraper/rules.py` emits.
- Stack is fixed: Vite + React 19 + TypeScript, Ant Design 6 components and theme tokens, TanStack Query, React Router, supabase-js. No Tailwind or other CSS frameworks.
- Light and dark mode are both first-class.
- Hosting: static build on Vercel's free tier; everything runs on free tiers.

## Evidence on Hand

- Real scraped data in the owner's Supabase project (private).
- Sample data for the demo in `web/src/data/demoData.ts`.
- No testimonials, users or metrics beyond the owner's own use; do not invent any.

## Product Principles

1. Scanning speed over decoration: the owner should see what's new and what needs action at a glance.
2. One action per common task: status changes and filtering stay one click or tap away, on desktop and phone.
3. The rules are auditable: dropped jobs and the reason they were dropped are always reachable.
4. Honest data: show what the scraper found, as it found it; no invented scores or claims.

## Accessibility & Inclusion

WCAG 2.2 AA as the baseline: text and UI contrast in both themes, full keyboard use, visible focus, touch targets that work on a phone.
