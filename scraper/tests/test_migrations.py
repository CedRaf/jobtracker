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


def ts_union(name):
    """The string values of `export type <name> = 'a' | 'b' | ...` in web/src/data/types.ts."""
    source = (ROOT / "web" / "src" / "data" / "types.ts").read_text(encoding="utf-8")
    body = re.search(rf"export type {name} =((?:\s*\|?\s*'[a-z_]+')+)", source).group(1)
    return set(re.findall(r"'([a-z_]+)'", body))


@pytest.mark.parametrize("sql_type, ts_type, extra", [
    ("job_status", "JobStatus", set()),
    ("job_source", "JobSource", {"manual"}),  # JobOrigin = JobSource | 'manual'
    ("application_channel", "ApplicationChannel", set()),
    ("role_type", "RoleType", set()),
    ("work_setup", "WorkSetup", set()),
])
def test_dashboard_types_match_the_enums(db, sql_type, ts_type, extra):
    assert {v for (v,) in enum_values(db, sql_type)} == ts_union(ts_type) | extra


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


# ---- the status machine ---------------------------------------------------------------


def move(conn, external_id, to, source="jobstreet", **params):
    """change_job_status(); returns (history_id, job as a dict)."""
    names = "".join(f", p_{k} => %s" for k in params)
    result = conn.execute(
        f"select public.change_job_status(%s, %s, %s{names})",
        [source, external_id, to, *params.values()]).fetchone()[0]
    return result["history_id"], result["job"]


def revert(conn, history_id):
    return conn.execute("select public.revert_status_change(%s)", [history_id]).fetchone()[0]["job"]


def correct(conn, external_id, to, source="jobstreet", **params):
    names = "".join(f", p_{k} => %s" for k in params)
    result = conn.execute(
        f"select public.correct_job_status(%s, %s, %s{names})",
        [source, external_id, to, *params.values()]).fetchone()[0]
    return result["history_id"], result["job"]


def history(conn, external_id):
    return conn.execute(
        """select from_status::text, to_status::text, kind, reverted_at is not null
           from public.status_history where job_external_id = %s order by id""",
        [external_id]).fetchall()


def test_moving_a_job_along_the_board_fills_in_the_dates(db):
    with session(db, "authenticated", APP_USER) as conn:
        move(conn, "new", "applied")
        row = job(conn, "new")
        now = conn.execute("select now()").fetchone()[0]
        assert row["applied_at"] == now and row["channel"] == "job_board"
        assert row["first_response_at"] is None

        move(conn, "new", "exam")
        assert job(conn, "new")["first_response_at"] == now
        assert history(conn, "new") == [
            ("new", "applied", "change", False), ("applied", "exam", "change", False)]


def test_direct_status_updates_are_refused(db):
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with session(db, "authenticated", APP_USER) as conn:
            conn.execute("update public.jobs set status = 'applied' where external_id = 'new'")


def test_even_the_service_role_cannot_update_a_status_directly(db):
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match="change_job_status"):
        with session(db, "service_role") as conn:
            conn.execute("update public.jobs set status = 'applied' where external_id = 'new'")


@pytest.mark.parametrize("external_id, to", [
    ("new", "rejected"),       # plan 1.3: Rejected only follows an application
    ("new", "interview"),
    ("new", "emailed"),        # nothing moves into the legacy Emailed status
    ("new", "expired"),        # only expire_stale_jobs() does that
    ("applied", "new"),        # plan 1.4: mistakes are undone, not moved back
    ("imported-rejected", "interview"),  # Rejected is final
])
def test_moves_outside_the_table_are_refused(db, external_id, to):
    with pytest.raises(psycopg.errors.CheckViolation, match="can't move"):
        with session(db, "authenticated", APP_USER) as conn:
            move(conn, external_id, to)


def test_a_stale_screen_cannot_move_a_job(db):
    with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState, match="reload"):
        with session(db, "authenticated", APP_USER) as conn:
            move(conn, "applied", "interview", expected_from="new")


def test_the_channel_and_date_you_give_are_kept(db):
    with session(db, "authenticated", APP_USER) as conn:
        move(conn, "new", "applied", channel="direct_message", applied_at=at(3))
        row = job(conn, "new")
        assert row["channel"] == "direct_message" and row["applied_at"] == at(3)


def test_a_skip_and_its_reason_are_saved_together_and_cleared_together(db):
    with session(db, "authenticated", APP_USER) as conn:
        move(conn, "new", "skip", skip_reason="  wants 3 years of Java ")
        assert job(conn, "new")["skip_reason"] == "wants 3 years of Java"
        move(conn, "new", "new")
        assert job(conn, "new")["skip_reason"] is None


def test_withdrawing_keeps_the_application(db):
    with session(db, "authenticated", APP_USER) as conn:
        move(conn, "applied", "withdrawn")
        row = job(conn, "applied")
        assert row["status"] == "withdrawn" and row["applied_at"] == at(1)


def test_legacy_emailed_jobs_move_on_like_applied_ones(db):
    with session(db, "postgres") as conn:
        conn.execute("select set_config('jobtracker.status_change', 'on', true)")
        conn.execute("update public.jobs set status = 'emailed' where external_id = 'applied'")
        conn.execute("select set_config('jobtracker.status_change', '', true)")
        conn.execute("select set_config('request.jwt.claim.sub', %s, true)", [APP_USER])
        move(conn, "applied", "interview")
        assert job(conn, "applied")["status"] == "interview"


# ---- undo ---------------------------------------------------------------------------


def test_undo_restores_every_field_and_drops_out_of_the_analytics(db):
    with session(db, "authenticated", APP_USER) as conn:
        before = job(conn, "applied")
        history_id, _ = move(conn, "applied", "offer")
        assert job(conn, "applied")["first_response_at"] is not None
        restored = revert(conn, history_id)
        assert restored["status"] == "applied"
        row = job(conn, "applied")
        fields = ("status", "applied_at", "first_response_at", "channel", "skip_reason", "status_changed_at")
        for field in fields:
            assert row[field] == before[field], field
        assert history(conn, "applied")[-1] == ("applied", "offer", "change", True)


def test_undo_brings_back_the_skip_reason_it_replaced(db):
    with session(db, "authenticated", APP_USER) as conn:
        move(conn, "new", "skip", skip_reason="bond")
        history_id, _ = move(conn, "new", "new")
        revert(conn, history_id)
        assert job(conn, "new")["skip_reason"] == "bond"


def test_only_the_latest_change_can_be_undone(db):
    with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState, match="latest"):
        with session(db, "authenticated", APP_USER) as conn:
            first, _ = move(conn, "new", "applied")
            move(conn, "new", "interview")
            revert(conn, first)


def test_undo_is_refused_after_the_job_was_edited(db):
    with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState, match="edited"):
        with session(db, "authenticated", APP_USER) as conn:
            history_id, _ = move(conn, "new", "applied")
            conn.execute("update public.jobs set applied_at = %s where external_id = 'new'", [at(2)])
            revert(conn, history_id)


def test_old_changes_without_a_snapshot_cannot_be_undone(db):
    with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState, match="Correct status"):
        with session(db, "authenticated", APP_USER) as conn:
            old = conn.execute("""select max(id) from public.status_history
                                  where job_external_id = 'emailed'""").fetchone()[0]
            revert(conn, old)


# ---- corrections --------------------------------------------------------------------


def test_a_correction_replaces_the_status_it_corrects(db):
    with session(db, "authenticated", APP_USER) as conn:
        move(conn, "new", "applied")
        move(conn, "new", "offer")  # meant Interview
        correct(conn, "new", "interview")
        assert history(conn, "new") == [
            ("new", "applied", "change", False),
            ("applied", "offer", "change", True),
            ("offer", "interview", "correction", False),
        ]
        assert job(conn, "new")["status"] == "interview"


def test_correcting_to_never_applied_clears_the_application(db):
    with session(db, "authenticated", APP_USER) as conn:
        correct(conn, "straight-to-interview", "skip", skip_reason="misclick")
        row = job(conn, "straight-to-interview")
        assert row["applied_at"] is None and row["first_response_at"] is None
        assert row["skip_reason"] == "misclick"


def test_undoing_a_correction_brings_back_what_it_replaced(db):
    with session(db, "authenticated", APP_USER) as conn:
        move(conn, "new", "applied")
        move(conn, "new", "offer")
        history_id, _ = correct(conn, "new", "interview")
        revert(conn, history_id)
        assert job(conn, "new")["status"] == "offer"
        assert [r[3] for r in history(conn, "new")] == [False, False, True]


def test_nothing_can_be_corrected_into_emailed(db):
    with pytest.raises(psycopg.errors.CheckViolation):
        with session(db, "authenticated", APP_USER) as conn:
            correct(conn, "new", "emailed")


# ---- expiry -------------------------------------------------------------------------


def test_jobs_left_in_new_for_15_days_expire(db):
    with session(db, "postgres") as conn:
        conn.execute("""update public.jobs set first_seen = now() - interval '16 days'
                        where external_id = 'new'""")
        assert conn.execute("select public.expire_stale_jobs()").fetchone()[0] == 1
        assert job(conn, "new")["status"] == "expired"
        assert history(conn, "new") == [("new", "expired", "expiry", False)]
        # You can still apply to (or skip) an expired job.
        conn.execute("select set_config('request.jwt.claim.sub', %s, true)", [APP_USER])
        move(conn, "new", "applied")


def test_recent_jobs_do_not_expire(db):
    with session(db, "postgres") as conn:
        conn.execute("""update public.jobs set first_seen = now() - interval '14 days'
                        where external_id = 'new'""")
        assert conn.execute("select public.expire_stale_jobs()").fetchone()[0] == 0


def test_dashboard_users_cannot_expire_jobs(db):
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with session(db, "authenticated", APP_USER) as conn:
            conn.execute("select public.expire_stale_jobs()")


# ---- guards on the fields a status depends on ---------------------------------------


def test_the_day_you_applied_cannot_be_cleared(db):
    with pytest.raises(psycopg.errors.CheckViolation, match="applied"):
        with session(db, "authenticated", APP_USER) as conn:
            conn.execute("update public.jobs set applied_at = null where external_id = 'applied'")


def test_the_first_response_cannot_be_cleared_once_you_heard_back(db):
    with pytest.raises(psycopg.errors.CheckViolation, match="first response"):
        with session(db, "authenticated", APP_USER) as conn:
            conn.execute("update public.jobs set first_response_at = null where external_id = 'emailed'")


def test_only_a_skipped_job_gets_a_skip_reason(db):
    with pytest.raises(psycopg.errors.CheckViolation, match="skip reason"):
        with session(db, "authenticated", APP_USER) as conn:
            conn.execute("update public.jobs set skip_reason = 'x' where external_id = 'applied'")


def test_existing_rows_that_break_the_rules_can_still_be_edited(db):
    # Imported Rejected job: no applied_at. Left alone, and notes still save.
    with session(db, "authenticated", APP_USER) as conn:
        conn.execute("update public.jobs set notes = 'old' where external_id = 'imported-rejected'")
        assert job(conn, "imported-rejected")["notes"] == "old"


def test_transitions_match_the_dashboard(db):
    source = (ROOT / "web" / "src" / "lib" / "transitions.ts").read_text(encoding="utf-8")
    body = re.search(r"export const TRANSITIONS[^=]*=\s*\{(.*?)\n\}", source, re.S).group(1)
    ts = {(frm, to) for frm, tos in re.findall(r"(\w+): \[([^\]]*)\]", body)
          for to in re.findall(r"'(\w+)'", tos)}
    sql = set(db.execute("""select from_status::text, to_status::text from public.job_status_transitions
                            where not system_only""").fetchall())
    assert ts == sql


# ---- inserts ------------------------------------------------------------------------


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
