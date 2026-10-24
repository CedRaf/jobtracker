"""
One-off import of the Google Sheet's history into Supabase.

Export each tab as CSV (File > Download > Comma-separated values), then run
once per source:

    python import_sheet.py --source jobstreet --jobs "Jobs.csv" --filtered "Filtered.csv"
    python import_sheet.py --source linkedin --jobs "LinkedIn.csv" --filtered "LinkedIn Filtered.csv"

Add --dry-run to only check the files and print what would be imported.
Rows you don't want can simply be deleted from the CSV first (keep the header).

Jobs already in Supabase (e.g. found by the scraper since dual-write began)
are left as they are, so statuses and notes you set in the dashboard win.
Add --overwrite to replace them with the sheet's values instead (descriptions,
which the sheet doesn't have, are kept either way). Filtered jobs that
already exist are always left alone.
Credentials: SUPABASE_URL / SUPABASE_SECRET_KEY or secrets.json, as for the scrapers.
"""

import argparse
import csv
import sys
from datetime import datetime

import sinks
from scraper import load_secrets, repost_key

STATUSES = {"new", "applied", "emailed", "interview", "offer", "rejected", "skip"}
SHEET_DATE_FORMATS = ("%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M", "%m/%d/%Y",
                      "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d")


def parse_sheet_date(value):
    """A date as the sheet shows it (Manila time) -> ISO timestamp, else None."""
    for fmt in SHEET_DATE_FORMATS:
        try:
            return datetime.strptime((value or "").strip(), fmt).replace(tzinfo=sinks.MANILA).isoformat()
        except ValueError:
            pass
    return None


def read_csv(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        return [row for row in csv.DictReader(f) if (row.get("id") or "").strip()]


def sheet_job_row(row, source):
    record = {**row, "repost_key": repost_key({"title": row["title"], "company": row.get("company", "")})}
    db_row = sinks.job_row(record, source)
    # Not in the sheet: leave whatever Supabase already has.
    del db_row["description"]
    status = (row.get("status") or "").strip().lower()
    db_row.update({
        "status": status if status in STATUSES else "new",
        "notes": (row.get("notes") or "").strip() or None,
        "email_drafted_at": parse_sheet_date(row.get("draft_created")),
    })
    first_seen = parse_sheet_date(row.get("first_seen"))
    if first_seen:
        db_row["first_seen"] = first_seen
    return db_row


def sheet_filtered_row(row, source):
    db_row = sinks.filtered_row(row, source)
    first_seen = parse_sheet_date(row.get("first_seen"))
    if first_seen:
        db_row["first_seen"] = first_seen
    return db_row


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--source", required=True, choices=["jobstreet", "linkedin"])
    parser.add_argument("--jobs", help="CSV export of the Jobs (or LinkedIn) tab")
    parser.add_argument("--filtered", help="CSV export of the Filtered (or LinkedIn Filtered) tab")
    parser.add_argument("--dry-run", action="store_true", help="check the files without importing")
    parser.add_argument("--overwrite", action="store_true",
                        help="replace jobs already in Supabase with the sheet's values (status, notes, ...)")
    args = parser.parse_args()
    if not args.jobs and not args.filtered:
        parser.error("give --jobs and/or --filtered")

    jobs = [sheet_job_row(r, args.source) for r in read_csv(args.jobs)] if args.jobs else []
    filtered = [sheet_filtered_row(r, args.source) for r in read_csv(args.filtered)] if args.filtered else []
    # PostgREST bulk inserts need every row to have the same keys.
    for rows in (jobs, filtered):
        keys = set().union(*(r.keys() for r in rows)) if rows else set()
        for r in rows:
            for k in keys - r.keys():
                r[k] = None

    statuses = {}
    for r in jobs:
        statuses[r["status"]] = statuses.get(r["status"], 0) + 1
    print(f"{args.source}: {len(jobs)} jobs {statuses}, {len(filtered)} filtered")
    if args.dry_run:
        print("Dry run: nothing imported.")
        return 0

    client = sinks.supabase_client(load_secrets())
    if not client:
        print("Supabase credentials missing (SUPABASE_URL / SUPABASE_SECRET_KEY or secrets.json).")
        return 1
    written = client.insert("jobs", jobs, on_conflict="source,external_id", merge=args.overwrite)
    added = client.insert("filtered_jobs", filtered, on_conflict="source,external_id")
    if args.overwrite:
        print(f"Imported: {written} jobs written (existing ones overwritten), {added} new filtered jobs.")
    else:
        print(f"Imported: {written} new jobs ({len(jobs) - written} already in Supabase, kept as they are), "
              f"{added} new filtered jobs.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
