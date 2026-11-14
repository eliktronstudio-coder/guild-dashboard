begin;
-- Bounded, guild-scoped aggregate read. Money always crosses JSON as decimal text.
create function public.dashboard_report(p_from timestamptz,p_until timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare g uuid; me uuid; result jsonb; finance jsonb:=null; weekly jsonb; ranking jsonb:=null;
begin
 select id into g from public.guilds where slug='xd';
 if not private.is_member(g) then raise exception 'FORBIDDEN'; end if;
 if p_from is null or p_until is null or not isfinite(p_from) or not isfinite(p_until)
 or p_from>=p_until or p_until-p_from>interval '366 days' then raise exception 'INVALID_PERIOD'; end if;
 select id into me from public.memberships where guild_id=g and user_id=private.viewer_id();
 with eligible as (
  select a.* from public.attendance a join public.events e on e.id=a.event_id and e.guild_id=a.guild_id
  where e.guild_id=g and e.status='completed' and e.counts_for_attendance and e.attendance_finalized_at is not null
  and e.starts_at<=now() and e.starts_at>=p_from and e.starts_at<p_until
 ) select jsonb_build_object(
  'members',case when public.has_permission(g,'members.read') then (select count(*) from public.memberships where guild_id=g and status='active') end,
  'pending_applications',case when public.has_permission(g,'applications.review') then (select count(*) from public.applications where guild_id=g and status='pending') end,
  'active_members',(select count(distinct membership_id) from eligible where mark='present'),
  'completed_events',(select count(*) from public.events where guild_id=g and status='completed' and starts_at<=now() and starts_at>=p_from and starts_at<p_until),
  'attendance',round(100.0*(select count(*) from eligible where mark='present')/nullif((select count(*) from eligible where mark in ('present','absent')),0),1),
  'own_attendance',round(100.0*(select count(*) from eligible where membership_id=me and mark='present')/nullif((select count(*) from eligible where membership_id=me and mark in ('present','absent')),0),1),
  'own_present',(select count(*) from eligible where membership_id=me and mark='present'),
  'upcoming',coalesce((select jsonb_agg(to_jsonb(e) order by e.starts_at,e.id) from
   (select id,title,starts_at from public.events where guild_id=g and status='scheduled' and starts_at>now() order by starts_at,id limit 5) e),'[]'::jsonb),
  'own_finance',public.my_treasury_summary(),
  'own_earned_units',(select coalesce(sum(w.amount_units),0)::text from public.treasury_awards w join public.treasury_allocations a on a.id=w.allocation_id
   where w.guild_id=g and w.membership_id=me and a.voided_at is null and a.created_at>=p_from and a.created_at<p_until)
 ) into result;

 with buckets as (
  select s b,greatest(s,p_from) lo,least(s+interval '7 days',p_until,now()) hi
  from generate_series(date_trunc('week',p_from at time zone 'UTC') at time zone 'UTC',p_until-interval '1 microsecond',interval '7 days') s
 ), eligible as (
  select e.starts_at,a.mark,a.membership_id from public.events e join public.attendance a on a.event_id=e.id and a.guild_id=e.guild_id
  where e.guild_id=g and e.status='completed' and e.counts_for_attendance and e.attendance_finalized_at is not null and e.starts_at<=now()
  and e.starts_at>=p_from and e.starts_at<p_until
 ), totals as (
  select b.b,b.lo,b.hi,count(*) filter(where a.mark='present') present,
   count(*) filter(where a.mark in ('present','absent')) applicable,
   count(distinct a.membership_id) filter(where a.mark='present') active
  from buckets b left join eligible a on a.starts_at>=b.lo and a.starts_at<b.hi group by b.b,b.lo,b.hi
 ) select coalesce(jsonb_agg(jsonb_build_object('from',lo,'until',hi,'active',active,
  'attendance',round(100.0*present/nullif(applicable,0),1)) order by b),'[]'::jsonb) into weekly from totals where lo<hi;

 if public.has_permission(g,'attendance.manage') then
  select coalesce(jsonb_agg(to_jsonb(r) order by r.present desc,r.percentage desc,r.membership_id),'[]'::jsonb) into ranking from
   (select * from public.attendance_report(p_from,p_until) where present>0 order by present desc,percentage desc,membership_id limit 10) r;
 end if;

 if public.has_permission(g,'treasury.read') then
  -- Ledger movements use their actual record/reversal timestamps. Opening cash includes all earlier movements.
  with movements as (
   select created_at at,gross_units::numeric sales,0::numeric reversed,gross_units::numeric cash from public.treasury_sales where guild_id=g
   union all select voided_at,0,gross_units,-gross_units::numeric from public.treasury_sales where guild_id=g and voided_at is not null
   union all select created_at,0,0,-amount_units::numeric from public.treasury_payouts where guild_id=g
   union all select voided_at,0,0,amount_units::numeric from public.treasury_payouts where guild_id=g and voided_at is not null
   union all select created_at,0,0,-amount_units::numeric from public.treasury_expenses where guild_id=g
   union all select voided_at,0,0,amount_units::numeric from public.treasury_expenses where guild_id=g and voided_at is not null
  ), buckets as (
   select greatest(s,p_from) lo,least(s+interval '7 days',p_until,now()) hi
   from generate_series(date_trunc('week',p_from at time zone 'UTC') at time zone 'UTC',p_until-interval '1 microsecond',interval '7 days') s
  ) select jsonb_build_object(
   'current',public.treasury_summary(),
   'sales_units',(select coalesce(sum(sales),0)::text from movements where at>=p_from and at<p_until and at<=now()),
   'reversed_units',(select coalesce(sum(reversed),0)::text from movements where at>=p_from and at<p_until and at<=now()),
   'opening_units',(select coalesce(sum(cash),0)::text from movements where at<p_from and at<=now()),
   'weeks',coalesce((select jsonb_agg(jsonb_build_object('from',b.lo,'until',b.hi,
    'sales_units',(select coalesce(sum(sales),0)::text from movements where at>=b.lo and at<b.hi),
    'reversed_units',(select coalesce(sum(reversed),0)::text from movements where at>=b.lo and at<b.hi),
    'balance_units',(select coalesce(sum(cash),0)::text from movements where at<b.hi)) order by b.lo) from buckets b where b.lo<b.hi),'[]'::jsonb)
  ) into finance;
 end if;
 return result||jsonb_build_object('weeks',weekly,'ranking',ranking,'finance',finance);
end $$;
revoke all on function public.dashboard_report(timestamptz,timestamptz) from public,anon;
grant execute on function public.dashboard_report(timestamptz,timestamptz) to authenticated;
commit;
