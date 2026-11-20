begin;
-- PostgREST hoists this RPC's transaction settings before executing it.
-- Bulk archiving must not inherit the 8-second interactive-query limit.
-- Keep a bounded runtime and fail quickly rather than waiting behind finance writes.
alter function public.archive_activities(uuid,date,date) set statement_timeout='30s';
alter function public.archive_activities(uuid,date,date) set lock_timeout='2s';
notify pgrst,'reload schema';
commit;
