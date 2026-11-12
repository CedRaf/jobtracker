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


def expiry_started(conn, days_ago):
    conn.execute("update public.job_expiry_start set since = now() - make_interval(days => %s)", [days_ago])


def test_jobs_left_in_new_for_15_days_expire(db):
    with session(db, "postgres") as conn:
        expiry_started(conn, 30)  # found after expiry started
        conn.execute("""update public.jobs set first_seen = now() - interval '16 days'
                        where external_id = 'new'""")
        assert conn.execute("select public.expire_stale_jobs()").fetchone()[0] == 1
        assert job(conn, "new")["status"] == "expired"
        assert history(conn, "new") == [("new", "expired", "expiry", False)]
        # You can still apply to (or skip) an expired job.
        conn.execute("select set_config('request.jwt.claim.sub', %s, true)", [APP_USER])
        move(conn, "new", "applied")


def test_expiry_start_on_a_database_that_already_ran_rollout_1():
    # As in production: 20261112000001 ran (and was used) before
    # 20261112000002 existed. Expiry should start at rollout 1's first change.
    name = f"jobtracker_test_{uuid.uuid4().hex[:12]}"
    with psycopg.connect(DB_URL, autocommit=True) as admin:
        admin.execute(f'create database "{name}"')
    try:
        with psycopg.connect(psycopg.conninfo.make_conninfo(DB_URL, dbname=name), autocommit=True) as conn:
            conn.execute(SUPABASE_STAND_INS)
            for path in MIGRATIONS:
                if path.name.startswith("20261112000002"):
                    break
                users = conn.execute("select count(*) from public.app_users").fetchone()[0] \
                    if path.name >= TRACKING else 1
                if not users:
                    insert_existing(conn)
                migrate(conn, path)
            conn.execute("select set_config('request.jwt.claim.sub', %s, false)", [APP_USER])
            move(conn, "applied", "interview")
            conn.execute("update public.status_history set changed_at = %s where before is not null",
                         [at(20)])
            conn.execute("update public.jobs set first_seen = %s where external_id = 'new'", [at(1)])
            migrate(conn, MIGRATIONS[[p.name[:14] for p in MIGRATIONS].index("20261112000002")])
            assert conn.execute("select since from public.job_expiry_start").fetchone()[0] == at(20)
            # The backlog job, in New since Oct 1, stays there.
            assert conn.execute("select public.expire_stale_jobs()").fetchone()[0] == 0
    finally:
        with psycopg.connect(DB_URL, autocommit=True) as admin:
            admin.execute(f'drop database if exists "{name}" with (force)')


def test_jobs_already_in_new_before_expiry_started_never_expire(db):
    # Existing data is left alone: only jobs found after the migration expire.
    with session(db, "postgres") as conn:
        conn.execute("""update public.jobs set first_seen = now() - interval '400 days'
                        where external_id = 'new'""")
        assert conn.execute("select public.expire_stale_jobs()").fetchone()[0] == 0
        assert job(conn, "new")["status"] == "new"


def test_an_old_job_brought_back_to_new_can_expire(db):
    with session(db, "postgres") as conn:
        expiry_started(conn, 30)
        conn.execute("""update public.jobs set first_seen = now() - interval '400 days',
                                               status_changed_at = now() - interval '20 days'
                        where external_id = 'new'""")
        assert conn.execute("select public.expire_stale_jobs()").fetchone()[0] == 1


def test_recent_jobs_do_not_expire(db):
    with session(db, "postgres") as conn:
        expiry_started(conn, 30)
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


# ---- the listing lifecycle (rollout 2) -----------------------------------------------


def scrape_insert(conn, table, external_id, source="jobstreet"):
    """An insert like the scraper's (ignore duplicates); returns how many rows went in."""
    columns = "source, external_id, title, url" + (", reason" if table == "filtered_jobs" else "")
    values = "%s, %s, 'Dev', 'https://example.test'" + (", 'rule'" if table == "filtered_jobs" else "")
    return conn.execute(f"insert into public.{table} ({columns}) values ({values}) on conflict do nothing",
                        [source, external_id]).rowcount


def test_a_kept_listing_is_never_also_filtered(db):
    with session(db, "service_role") as conn:
        assert scrape_insert(conn, "filtered_jobs", "applied") == 0  # 'applied' is in jobs
        assert scrape_insert(conn, "filtered_jobs", "fresh") == 1


def test_a_filtered_listing_is_never_also_kept(db):
    with session(db, "service_role") as conn:
        scrape_insert(conn, "filtered_jobs", "dropped")
        assert scrape_insert(conn, "jobs", "dropped") == 0
        assert job(conn, "dropped") is None


def test_the_same_id_on_another_site_is_a_different_listing(db):
    with session(db, "service_role") as conn:
        scrape_insert(conn, "filtered_jobs", "42", source="linkedin")
        assert scrape_insert(conn, "jobs", "42", source="jobstreet") == 1


def test_already_closed_listings_are_kept_from_the_dashboard(db):
    with session(db, "service_role") as conn:
        conn.execute("insert into public.expired_listings (source, external_id) values ('linkedin', '9')")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with session(db, "authenticated", APP_USER) as conn:
            conn.execute("select * from public.expired_listings")


def found_days_ago(conn, days, external_id="new"):
    conn.execute("""update public.jobs set first_seen = now() - make_interval(days => %s)
                    where external_id = %s""", [days, external_id])


def recheck(conn, source="jobstreet"):
    return [r[0] for r in conn.execute("select public.jobs_to_recheck(%s)", [source]).fetchall()]


def test_new_jobs_aged_3_to_15_days_are_rechecked(db):
    with session(db, "postgres") as conn:
        expiry_started(conn, 30)
        for external_id, days in [("new", 5), ("applied", 5)]:
            conn.execute("""update public.jobs set first_seen = now() - make_interval(days => %s),
                                                   status_changed_at = null
                            where external_id = %s""", [days, external_id])
        assert recheck(conn) == ["new"]  # 'applied' isn't in New
        found_days_ago(conn, 1)
        assert recheck(conn) == []  # too young
        found_days_ago(conn, 16)
        assert recheck(conn) == []  # expires by age instead


def test_the_older_backlog_is_never_rechecked(db):
    with session(db, "postgres") as conn:
        found_days_ago(conn, 5)
        assert recheck(conn) == []  # in New since before expiry started


def test_closed_postings_move_to_expired(db):
    with session(db, "postgres") as conn:
        expiry_started(conn, 30)
        found_days_ago(conn, 5)
        moved = conn.execute("select public.expire_closed_jobs('jobstreet', array['new', 'applied', 'nope'])")
        assert moved.fetchone()[0] == 1  # only the job in New
        assert job(conn, "new")["status"] == "expired" and job(conn, "applied")["status"] == "applied"
        assert history(conn, "new") == [("new", "expired", "expiry", False)]


def test_closed_postings_from_the_backlog_are_left_alone(db):
    with session(db, "postgres") as conn:
        moved = conn.execute("select public.expire_closed_jobs('jobstreet', array['new'])")
        assert moved.fetchone()[0] == 0


@pytest.mark.parametrize("call", [
    "select public.jobs_to_recheck('jobstreet')",
    "select public.dispatch_scrapers(array['jobstreet'])",
    "select public.record_dispatch_replies()",
    "select public.expire_closed_jobs('jobstreet', array['new'])",
])
def test_only_the_scraper_and_the_scheduler_call_these(db, call):
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with session(db, "authenticated", APP_USER) as conn:
            conn.execute(call)


# ---- scrape runs and dispatches (rollouts 3 and 4) ------------------------------------


def new_run(conn, **values):
    columns = ", ".join(["source", *values])
    params = ", ".join(["'jobstreet'", *["%s"] * len(values)])
    return conn.execute(f"insert into public.scrape_runs ({columns}) values ({params}) returning id, status",
                        list(values.values())).fetchone()


def test_a_run_starts_running(db):
    with session(db, "service_role") as conn:
        assert new_run(conn)[1] == "running"


@pytest.mark.parametrize("values", [
    {"status": "failed"},                 # failed without saying why
    {"status": "ok", "error": "boom"},    # an error on a run that isn't failed
    {"status": "done"},                   # not a status
])
def test_run_statuses_are_checked(db, values):
    with pytest.raises(psycopg.errors.CheckViolation):
        with session(db, "service_role") as conn:
            new_run(conn, **values)


def test_a_run_records_the_dispatch_that_started_it(db):
    with session(db, "service_role") as conn:
        dispatch = conn.execute("""insert into public.scraper_dispatches (sources) values ('{jobstreet}')
                                   returning id""").fetchone()[0]
        run_id, _ = new_run(conn, dispatch_id=dispatch, status="ok", warning="re-check failed")
        row = conn.execute("select dispatch_id, warning from public.scrape_runs where id = %s",
                           [run_id]).fetchone()
        assert row == (dispatch, "re-check failed")


def capture_requests(conn):
    """Swaps pg_net's stand-in for one that keeps the request body (this transaction only)."""
    conn.execute("create table net.sent (id bigint generated always as identity, body jsonb)")
    conn.execute("""create or replace function net.http_post(url text, body jsonb, headers jsonb,
                                                           timeout_milliseconds integer)
                    returns bigint language sql as
                    $$ insert into net.sent (body) values (body) returning id $$""")


def dispatch_row(conn, dispatch_id):
    return conn.execute("""select status, request_id, status_code, error from public.scraper_dispatches
                           where id = %s""", [dispatch_id]).fetchone()


def test_a_dispatch_without_a_token_says_so(db):
    with session(db, "postgres") as conn:
        dispatch_id = conn.execute("select public.dispatch_scrapers(array['jobstreet'])").fetchone()[0]
        status, _, _, error = dispatch_row(conn, dispatch_id)
        assert status == "no_token" and error.startswith("No GitHub token")


def test_a_dispatch_sends_its_id_to_the_workflow_and_waits_for_the_reply(db):
    with session(db, "postgres") as conn:
        capture_requests(conn)
        conn.execute("insert into vault.decrypted_secrets values ('github_scraper_token', 't')")
        dispatch_id = conn.execute(
            "select public.dispatch_scrapers(array['jobstreet', 'linkedin'])").fetchone()[0]
        status, request_id, _, _ = dispatch_row(conn, dispatch_id)
        assert status == "pending"
        body = conn.execute("select body from net.sent where id = %s", [request_id]).fetchone()[0]
        assert body["inputs"] == {"sources": "jobstreet,linkedin", "dispatch_id": str(dispatch_id)}


@pytest.mark.parametrize("reply, expected", [
    ((204, None, None), ("accepted", 204, None)),
    ((401, '{"message":"Bad credentials"}', None), ("failed", 401, '{"message":"Bad credentials"}')),
    ((None, None, "Timeout of 10000 ms reached"), ("failed", None, "Timeout of 10000 ms reached")),
])
def test_replies_settle_a_dispatch(db, reply, expected):
    with session(db, "postgres") as conn:
        capture_requests(conn)
        conn.execute("insert into vault.decrypted_secrets values ('github_scraper_token', 't')")
        dispatch_id = conn.execute("select public.dispatch_scrapers(array['jobstreet'])").fetchone()[0]
        request_id = dispatch_row(conn, dispatch_id)[1]
        conn.execute("insert into net._http_response values (%s, %s, %s, %s)", [request_id, *reply])
        conn.execute("select public.record_dispatch_replies()")
        status, _, status_code, error = dispatch_row(conn, dispatch_id)
        assert (status, status_code, error) == expected


def test_a_dispatch_unanswered_for_6_hours_is_lost(db):
    with session(db, "postgres") as conn:
        stale = conn.execute("""insert into public.scraper_dispatches (sources, request_id, created_at)
                                values ('{jobstreet}', 77, now() - interval '7 hours')
                                returning id""").fetchone()[0]
        recent = conn.execute("""insert into public.scraper_dispatches (sources, request_id)
                                 values ('{jobstreet}', 78) returning id""").fetchone()[0]
        conn.execute("select public.record_dispatch_replies()")
        assert dispatch_row(conn, stale)[0] == "lost" and dispatch_row(conn, recent)[0] == "pending"
