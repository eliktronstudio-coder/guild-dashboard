-- Periods are paused in the UI. Read the lifetime balances without rewriting sales.
begin;
create function public.treasury_lifetime_summary() returns jsonb
language sql stable security definer set search_path='' as $$
 select public.treasury_summary_before_periods();
$$;
revoke all on function public.treasury_lifetime_summary() from public,anon;
grant execute on function public.treasury_lifetime_summary() to authenticated;
notify pgrst,'reload schema';
commit;
