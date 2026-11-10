-- New enum values for application tracking, in their own migration: Postgres
-- can't use an enum value in the transaction that adds it, and the next
-- migration's policies and backfill use both.
--
--   * exam: a take-home or online test, a stage between Emailed and Interview
--     on the board.
--   * manual: applications you log yourself (referrals, direct messages,
--     company sites), which no scraper found.

alter type public.job_status add value if not exists 'exam' before 'interview';

alter type public.job_source add value if not exists 'manual';
