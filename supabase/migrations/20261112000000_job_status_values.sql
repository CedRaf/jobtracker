-- New job statuses for the explicit status machine (docs/STATE_MACHINE_PLAN.md,
-- rollout 1). In their own migration: Postgres can't use an enum value in the
-- transaction that adds it, and the next migration's transition table does.
--
--   * withdrawn: you pulled out after applying (this used to be lumped into Skip).
--   * expired: a job left in New for 15 days, or (rollout 2) whose posting closed.
--
-- 'emailed' stays in the type for the jobs that already have it, but nothing
-- moves into it any more: how you applied is the job's channel.

alter type public.job_status add value if not exists 'withdrawn' after 'rejected';

alter type public.job_status add value if not exists 'expired' after 'skip';
