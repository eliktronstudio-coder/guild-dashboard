begin;
-- Only throttling metadata, no initData, tokens or user profile copies.
create table private.telegram_mini_app_limits (
 telegram_id bigint primary key check(telegram_id between 1 and 9007199254740991),
 window_start timestamptz not null,requests integer not null check(requests between 1 and 20)
);
create index telegram_mini_app_limits_window on private.telegram_mini_app_limits(window_start);
alter table private.telegram_mini_app_limits enable row level security;
revoke all on private.telegram_mini_app_limits from public,anon,authenticated,service_role;

-- Trusted server calls this only after checking Telegram HMAC and auth_date.
-- Browser auth and its JWT/session are deliberately not impersonated or created.
create function public.telegram_mini_app_report(p_telegram bigint,p_period text)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare start_at timestamptz;result jsonb;lim private.telegram_mini_app_limits;
begin
 if p_telegram is null or p_telegram<1 or p_telegram>9007199254740991 then raise exception 'FORBIDDEN';end if;
 if p_period is null or p_period not in ('week','month') then raise exception 'INVALID_PERIOD';end if;
 -- Per-ID lock serializes concurrent requests across all Vercel workers.
 perform pg_advisory_xact_lock(751925,(p_telegram%2147483647)::integer);
 select * into lim from private.telegram_mini_app_limits where telegram_id=p_telegram;
 if lim.telegram_id is not null and lim.window_start>clock_timestamp()-interval '1 minute' and lim.requests>=20 then
  return jsonb_build_object('error','rate_limited');
 end if;
 insert into private.telegram_mini_app_limits(telegram_id,window_start,requests) values(p_telegram,clock_timestamp(),1)
 on conflict(telegram_id) do update set
 requests=case when private.telegram_mini_app_limits.window_start>clock_timestamp()-interval '1 minute' then private.telegram_mini_app_limits.requests+1 else 1 end,
 window_start=case when private.telegram_mini_app_limits.window_start>clock_timestamp()-interval '1 minute' then private.telegram_mini_app_limits.window_start else clock_timestamp() end;
 -- Bounded cleanup never waits on another request's window row.
 delete from private.telegram_mini_app_limits stale using
  (select telegram_id from private.telegram_mini_app_limits where window_start<clock_timestamp()-interval '1 day'
   order by window_start limit 100 for update skip locked) expired where stale.telegram_id=expired.telegram_id;
 start_at:=date_trunc(p_period,now());
 -- One snapshot of the current binding, membership and all returned personal data.
 select jsonb_build_object('nickname',m.nickname,'period',p_period,
  'stats',private.telegram_personal_stats(l.id,start_at,date_trunc('day',now())+interval '1 day'),
  'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.starts_at,e.id) from
   (select e.id,e.title,e.starts_at,exists(select 1 from public.event_signups s where s.event_id=e.id and s.membership_id=m.id) signed_up
    from public.events e where e.guild_id=m.guild_id and e.status='scheduled' and e.starts_at>now()
    order by starts_at,id limit 10) e),'[]'::jsonb)) into result
 from private.telegram_links l join public.memberships m on m.id=l.membership_id
 where l.telegram_id=p_telegram and private.telegram_active(m.id);
 -- Returning an error keeps the rate-limit counter for unlinked/blocked signed users.
 return coalesce(result,jsonb_build_object('error','forbidden'));
end $$;
revoke all on function public.telegram_mini_app_report(bigint,text) from public,anon,authenticated;
grant execute on function public.telegram_mini_app_report(bigint,text) to service_role;
commit;
