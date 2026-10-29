-- Himalayas (himalayas.app), a remote job board with a public JSON API, as a
-- third job source. Push this before the first Himalayas run: the scraper's
-- inserts fail on an unknown job_source value.

alter type public.job_source add value if not exists 'himalayas';
