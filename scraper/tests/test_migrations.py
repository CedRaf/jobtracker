"""The Supabase migrations, applied to a real Postgres.

Runs only when TEST_DATABASE_URL points at a Postgres where this user may
create databases (CI starts one; locally, any Postgres 15+). Each run creates
and drops its own database. Supabase's own pieces (the auth schema, its roles,
pg_cron, pg_net and Vault) are replaced by small stand-ins.

Existing jobs are inserted after the older migrations and before the
application-tracking ones, so the backfill runs on realistic rows.
"""
import os
import re
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import pytest

DB_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="set TEST_DATABASE_URL to run the migration tests")
psycopg = pytest.importorskip("psycopg")

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = sorted((ROOT / "supabase" / "migrations").glob("*.sql"))
# Migrations from this one on run after the existing rows below are inserted.
TRACKING = "20261110000000"

APP_USER = "00000000-0000-0000-0000-00000000000a"
OUTSIDER = "00000000-0000-0000-0000-00000000000b"

SUPABASE_STAND_INS = """
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;

create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;

create schema extensions;
create schema cron;
create function cron.schedule(name text, schedule text, command text) returns bigint
  language sql as $$ select 1::bigint $$;
create schema net;
create table net._http_response (id bigint, status_code integer, content text, error_msg text);
create function net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds integer)
  returns bigint language sql as $$ select 1::bigint $$;
create schema vault;
create table vault.decrypted_secrets (name text, decrypted_secret text);
"""


def at(day, hour=0):
    return datetime(2026, 10, day, hour, tzinfo=timezone.utc)


# Jobs as they were before application tracking. history: (to_status, day).
EXISTING = [
    dict(id="new", status="new", arrangements=["On-site"], location="Cebu City, Cebu"),
    dict(id="applied", status="applied", arrangements=["Remote"], location="Anywhere",
         history=[("applied", 1)]),
    dict(id="emailed", status="interview", arrangements=["Hybrid"], location="Makati City",
         history=[("emailed", 2), ("interview", 6)]),
    # Imported from the Sheet: no history at all.
    dict(id="imported-rejected", status="rejected", arrangements=["On-site"],
         location="Makati City, Metro Manila"),
    dict(id="imported-applied", status="applied", arrangements=["Remote", "On-site"], location="Cebu",
         status_changed_at=datetime(2026, 9, 1, tzinfo=timezone.utc)),
    # Straight from New to Interview: the interview implies an application.
    dict(id="straight-to-interview", status="interview", arrangements=[], location="Cebu",
         history=[("interview", 5)]),
    dict(id="skipped", status="skip", arrangements=["On-site"], location="Taguig"),
]


def migrate(conn, path):
    sql = path.read_text(encoding="utf-8")
    # The extensions are stand-ins here (SUPABASE_STAND_INS).
    sql = re.sub(r"^create extension[^;]*;", "", sql, flags=re.M | re.I)
    with conn.transaction():
        conn.execute(sql)


def insert_existing(conn):
    conn.execute("insert into auth.users (id) values (%s), (%s)", [APP_USER, OUTSIDER])
    conn.execute("insert into public.app_users (user_id) values (%s)", [APP_USER])
    for job in EXISTING:
        conn.execute(
            """insert into public.jobs (source, external_id, title, url, status, work_arrangements,
                                        location, status_changed_at)
               values ('jobstreet', %s, 'Junior Developer', 'https://example.test', %s, %s, %s, %s)""",
            [job["id"], job["status"], job["arrangements"], job["location"], job.get("status_changed_at")])
        previous = "new"
        for status, day in job.get("history", []):
            conn.execute(
                """insert into public.status_history
                     (job_source, job_external_id, from_status, to_status, changed_at)
                   values ('jobstreet', %s, %s, %s, %s)""",
                [job["id"], previous, status, at(day)])
            previous = status


@pytest.fixture(scope="module")
def db():
    name = f"jobtracker_test_{uuid.uuid4().hex[:12]}"
    with psycopg.connect(DB_URL, autocommit=True) as admin:
        admin.execute(f'create database "{name}"')
    try:
        url = psycopg.conninfo.make_conninfo(DB_URL, dbname=name)
        with psycopg.connect(url, autocommit=True) as conn:
            conn.execute(SUPABASE_STAND_INS)
            for path in MIGRATIONS:
                if path.name >= TRACKING and not conn.execute(
                        "select count(*) from public.app_users").fetchone()[0]:
                    insert_existing(conn)
                migrate(conn, path)
            yield conn
    finally:
        with psycopg.connect(DB_URL, autocommit=True) as admin:
            admin.execute(f'drop database if exists "{name}" with (force)')


@contextmanager
def session(conn, role="postgres", user=None):
    """A transaction as `role` (and logged in as `user`), always rolled back."""
    with conn.transaction(force_rollback=True):
        if user:
            conn.execute("select set_config('request.jwt.claim.sub', %s, true)", [user])
        if role != "postgres":
            conn.execute(f"set local role {role}")
        yield conn


def job(conn, external_id, source="jobstreet"):
    cur = conn.execute("select * from public.jobs where source = %s and external_id = %s",
                       [source, external_id])
    columns = [c.name for c in cur.description]
    row = cur.fetchone()
    return dict(zip(columns, row, strict=True)) if row else None


def enum_values(conn, type_name):
    return conn.execute(f"select unnest(enum_range(null::public.{type_name}))::text").fetchall()


# ---- enums --------------------------------------------------------------------------


def test_exam_sits_between_emailed_and_interview(db):
    statuses = [v for (v,) in enum_values(db, "job_status")]
    assert statuses.index("emailed") < statuses.index("exam") < statuses.index("interview")
    assert ("manual",) in enum_values(db, "job_source")


# ---- backfill -----------------------------------------------------------------------


def test_untouched_jobs_stay_unknown(db):
    for external_id in ("new", "skipped"):
        row = job(db, external_id)
        assert row["applied_at"] is None and row["first_response_at"] is None
        assert row["channel"] == "unknown"
        assert row["resume_version"] == "unknown" and row["role_type"] == "unknown"


def test_applied_at_comes_from_the_first_application(db):
    row = job(db, "applied")
    assert row["applied_at"] == at(1)
    assert row["first_response_at"] is None
    assert row["channel"] == "job_board"


def test_emailed_jobs_were_direct_messages_with_a_response_after(db):
    row = job(db, "emailed")
    assert row["applied_at"] == at(2)
    assert row["first_response_at"] == at(6)
    assert row["channel"] == "direct_message"


def test_imported_jobs_fall_back_to_their_status_date(db):
    applied = job(db, "imported-applied")
    assert applied["applied_at"] == datetime(2026, 9, 1, tzinfo=timezone.utc)
    rejected = job(db, "imported-rejected")
    # Rejected implies an application, but nothing says when: unknown, never guessed.
    assert rejected["applied_at"] is None and rejected["first_response_at"] is None
    assert rejected["channel"] == "job_board"


def test_a_stage_without_an_application_dates_the_application_not_a_response(db):
    row = job(db, "straight-to-interview")
    assert row["applied_at"] == at(5)
    assert row["first_response_at"] is None


@pytest.mark.parametrize("external_id, setup", [
    ("new", "cebu_onsite"),
    ("applied", "remote"),
    ("emailed", "hybrid"),
    ("imported-rejected", "manila_onsite"),
    ("imported-applied", "unknown"),       # Remote and On-site disagree
    ("straight-to-interview", "unknown"),  # nothing listed
    ("skipped", "manila_onsite"),          # Taguig is in Metro Manila
])
def test_work_setup_is_guessed_from_the_listing(db, external_id, setup):
    assert job(db, external_id)["work_setup"] == setup


# ---- triggers -----------------------------------------------------------------------


def test_moving_a_job_along_the_board_fills_in_the_dates(db):
    with session(db, "authenticated", APP_USER) as conn:
        conn.execute("update public.jobs set status = 'applied' where external_id = 'new'")
        row = job(conn, "new")
        now = conn.execute("select now()").fetchone()[0]
        assert row["applied_at"] == now and row["channel"] == "job_board"
        assert row["first_response_at"] is None

        conn.execute("update public.jobs set status = 'exam' where external_id = 'new'")
        assert job(conn, "new")["first_response_at"] == now
        statuses = conn.execute(
            "select to_status::text from public.status_history where job_external_id = 'new' order by id"
        ).fetchall()
        assert statuses == [("applied",), ("exam",)]


def test_drafting_an_email_counts_as_a_direct_message(db):
    with session(db, "authenticated", APP_USER) as conn:
        conn.execute("update public.jobs set status = 'emailed' where external_id = 'new'")
        assert job(conn, "new")["channel"] == "direct_message"


def test_the_trigger_never_overwrites_what_you_set(db):
    with session(db, "authenticated", APP_USER) as conn:
        conn.execute("""update public.jobs set channel = 'referral', applied_at = %s
                        where external_id = 'new'""", [at(3)])
        conn.execute("update public.jobs set status = 'applied' where external_id = 'new'")
        row = job(conn, "new")
        assert row["channel"] == "referral" and row["applied_at"] == at(3)


def test_new_straight_to_rejected_is_not_a_same_day_response(db):
    with session(db, "authenticated", APP_USER) as conn:
        conn.execute("update public.jobs set status = 'rejected' where external_id = 'new'")
        row = job(conn, "new")
        assert row["applied_at"] is not None and row["first_response_at"] is None


def test_scraped_jobs_get_a_work_setup_on_insert(db):
    with session(db, "service_role") as conn:
        conn.execute("""insert into public.jobs (source, external_id, title, url, work_arrangements, location)
                        values ('linkedin', 'x', 'Dev', 'https://example.test', '{Remote}', 'Philippines')""")
        row = job(conn, "x", "linkedin")
        assert row["work_setup"] == "remote" and row["applied_at"] is None


def test_a_response_before_the_application_is_rejected(db):
    with pytest.raises(psycopg.errors.CheckViolation):
        with session(db, "authenticated", APP_USER) as conn:
            conn.execute("""update public.jobs set first_response_at = %s
                            where external_id = 'emailed'""", [at(1)])


# ---- manual applications -------------------------------------------------------------


def log_application(conn, source="manual", **columns):
    values = {"source": source, "external_id": "m1", "title": "Frontend Developer", "company": "Acme",
              "url": "", "status": "applied", "channel": "referral", "resume_version": "web",
              "role_type": "web", "work_setup": "remote", "applied_at": at(4), **columns}
    names = ", ".join(values)
    conn.execute(f"insert into public.jobs ({names}) values ({', '.join(['%s'] * len(values))})",
                 list(values.values()))


def test_you_can_log_a_manual_application(db):
    with session(db, "authenticated", APP_USER) as conn:
        log_application(conn)
        row = job(conn, "m1", "manual")
        assert row["channel"] == "referral" and row["applied_at"] == at(4)
        history = conn.execute("""select from_status, to_status::text, changed_at from public.status_history
                                  where job_source = 'manual'""").fetchall()
        assert history == [(None, "applied", at(4))]


def test_manual_applications_keep_an_unknown_channel(db):
    # Only scraped jobs get a channel guessed; a referral isn't a job board.
    with session(db, "authenticated", APP_USER) as conn:
        log_application(conn, channel="unknown")
        assert job(conn, "m1", "manual")["channel"] == "unknown"


def test_you_cannot_insert_scraped_jobs(db):
    with pytest.raises(psycopg.errors.InsufficientPrivilege):  # row-level security
        with session(db, "authenticated", APP_USER) as conn:
            log_application(conn, source="jobstreet")


def test_outsiders_cannot_log_applications(db):
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with session(db, "authenticated", OUTSIDER) as conn:
            log_application(conn)


def test_an_unknown_resume_version_is_refused(db):
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        with session(db, "authenticated", APP_USER) as conn:
            log_application(conn, resume_version="nope")


# ---- resume versions ----------------------------------------------------------------


def test_you_can_add_a_resume_version_and_use_it(db):
    with session(db, "authenticated", APP_USER) as conn:
        conn.execute("insert into public.resume_versions (key, label) values ('data', 'Data')")
        conn.execute("update public.jobs set resume_version = 'data' where external_id = 'applied'")
        assert job(conn, "applied")["resume_version"] == "data"


def test_resume_version_keys_are_checked(db):
    with pytest.raises(psycopg.errors.CheckViolation):
        with session(db, "authenticated", APP_USER) as conn:
            conn.execute("insert into public.resume_versions (key, label) values ('Has Spaces', 'X')")


def test_outsiders_see_no_resume_versions(db):
    with session(db, "authenticated", OUTSIDER) as conn:
        assert conn.execute("select count(*) from public.resume_versions").fetchone()[0] == 0


# ---- what stays locked ----------------------------------------------------------------


def test_you_can_edit_the_new_columns(db):
    with session(db, "authenticated", APP_USER) as conn:
        conn.execute("""update public.jobs
                        set channel = 'company_site', resume_version = 'ai', role_type = 'ai',
                            work_setup = 'hybrid', applied_at = %s, first_response_at = %s
                        where external_id = 'applied'""", [at(1), at(9)])
        row = job(conn, "applied")
        assert (row["channel"], row["role_type"], row["first_response_at"]) == ("company_site", "ai", at(9))


def test_scraper_columns_stay_read_only(db):
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with session(db, "authenticated", APP_USER) as conn:
            conn.execute("update public.jobs set title = 'x' where external_id = 'applied'")


def test_outsiders_change_nothing(db):
    with session(db, "authenticated", OUTSIDER) as conn:
        cur = conn.execute("update public.jobs set channel = 'other' where external_id = 'applied'")
        assert cur.rowcount == 0


def test_anonymous_users_get_nothing(db):
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with session(db, "anon") as conn:
            conn.execute("select * from public.jobs")


def test_history_is_still_read_only(db):
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with session(db, "authenticated", APP_USER) as conn:
            conn.execute("delete from public.status_history")
