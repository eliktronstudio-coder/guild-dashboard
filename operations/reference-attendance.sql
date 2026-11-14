begin isolation level repeatable read;

create temp table attendance_release_guard(name text primary key,digest text) on commit drop;
do $$declare t text;h text;begin
 foreach t in array array['period_archives','payroll_batches','payroll_requests','treasury_allocations','treasury_awards','treasury_payouts','treasury_loot','treasury_sales','treasury_pools','treasury_expenses'] loop
 execute format('select md5(coalesce(string_agg(md5(row_to_json(r)::text), %L order by md5(row_to_json(r)::text)),%L)) from public.%I r','','',t) into h;
 insert into attendance_release_guard values(t,h);
 end loop;end $$;

-- Port the reference XD-site attendance rules: overall/Mini use event counts;
-- Prime uses saved activity weights. Everyone shares the complete event set,
-- independently of registration time and missing absence rows.
-- The reference project classifies attendance by activity name, independently
-- from the financial treasury source. PvP always belongs to Prime.
create function private.attendance_bucket(p_name text,p_kind text) returns text
language sql immutable set search_path='' as $$
 select case when p_kind='pvp' then 'prime' when lower(coalesce(p_name,'')) ~ '(^|[^[:alnum:]])(агл|кошка)([^[:alnum:]]|$)' then 'mini_rb' else 'prime' end;
$$;
revoke all on function private.attendance_bucket(text,text) from public,anon,authenticated;
create function private.attendance_event_counts(g uuid,p_from timestamptz,p_until timestamptz)
returns table(membership_id uuid,total_count bigint,present_count bigint,prime_total_count bigint,prime_present_count bigint,mini_total_count bigint,mini_present_count bigint,pvp_total_count bigint,pvp_present_count bigint,excused_count bigint,excluded_count bigint,prime_total_weight numeric,prime_present_weight numeric)
language sql stable security definer set search_path='' as $$
 with events as (
 select e.id,e.kind,private.attendance_bucket(coalesce(nullif(e.activity_banner_name,''),e.title),e.kind) category,coalesce(e.activity_weight,100)::numeric weight
 from public.events e where e.guild_id=g and e.status='completed' and e.deleted_at is null and not e.inventory_receipt and e.counts_for_attendance
 and e.starts_at>=p_from and e.starts_at<p_until and e.starts_at<=now()
 ), totals as (
 select count(*) total_count,count(*) filter(where category='prime') prime_total_count,count(*) filter(where category='mini_rb') mini_total_count,
 count(*) filter(where kind='pvp') pvp_total_count,coalesce(sum(weight) filter(where category='prime'),0) prime_total_weight from events
 ), marks as (
 select a.membership_id,count(*) filter(where a.mark='present') present_count,
 count(*) filter(where a.mark='present' and e.category='prime') prime_present_count,count(*) filter(where a.mark='present' and e.category='mini_rb') mini_present_count,
 count(*) filter(where a.mark='present' and e.kind='pvp') pvp_present_count,
 count(*) filter(where a.mark='excused') excused_count,count(*) filter(where a.mark='excluded') excluded_count,
 coalesce(sum(e.weight) filter(where a.mark='present' and e.category='prime'),0) prime_present_weight
 from events e join public.attendance a on a.event_id=e.id and a.guild_id=g group by a.membership_id
 )
 select m.id,t.total_count,coalesce(a.present_count,0),t.prime_total_count,coalesce(a.prime_present_count,0),t.mini_total_count,coalesce(a.mini_present_count,0),t.pvp_total_count,coalesce(a.pvp_present_count,0),coalesce(a.excused_count,0),coalesce(a.excluded_count,0),t.prime_total_weight,coalesce(a.prime_present_weight,0)
 from public.memberships m cross join totals t left join marks a on a.membership_id=m.id where m.guild_id=g;
$$;
revoke all on function private.attendance_event_counts(uuid,timestamptz,timestamptz) from public,anon,authenticated;

create function public.attendance_category_report(p_from timestamptz,p_until timestamptz)
returns table(membership_id uuid,nickname text,present bigint,absent bigint,excused bigint,excluded bigint,percentage numeric,total bigint,prime_present bigint,prime_total bigint,prime_percentage numeric,mini_present bigint,mini_total bigint,mini_percentage numeric,pvp_present bigint,pvp_total bigint,pvp_percentage numeric)
language plpgsql stable security definer set search_path='' as $$
declare g uuid;actor uuid:=private.viewer_id();
begin
 select id into g from public.guilds where slug='xd';
 if actor is null or not private.is_member(g) then raise exception 'FORBIDDEN';end if;
 if p_from is null or p_until is null or not isfinite(p_from) or not isfinite(p_until) or p_from>=p_until or p_until-p_from>interval '366 days' then raise exception 'INVALID_PERIOD';end if;
 return query select m.id,m.nickname,c.present_count,c.total_count-c.present_count-c.excused_count-c.excluded_count,c.excused_count,c.excluded_count,
 coalesce(round(100.0*c.present_count/nullif(c.total_count,0),0),0),c.total_count,
 c.prime_present_count,c.prime_total_count,coalesce(round(100.0*c.prime_present_weight/nullif(c.prime_total_weight,0),0),0),
 c.mini_present_count,c.mini_total_count,coalesce(round(100.0*c.mini_present_count/nullif(c.mini_total_count,0),0),0),
 c.pvp_present_count,c.pvp_total_count,coalesce(round(100.0*c.pvp_present_count/nullif(c.pvp_total_count,0),0),0)
 from private.attendance_event_counts(g,p_from,p_until) c join public.memberships m on m.id=c.membership_id
 where m.user_id=actor or public.has_permission(g,'attendance.manage') order by m.nickname,m.id;
end $$;
revoke all on function public.attendance_category_report(timestamptz,timestamptz) from public,anon;
grant execute on function public.attendance_category_report(timestamptz,timestamptz) to authenticated;
-- Preserve the existing export/report signature and its access restrictions.
create or replace function public.attendance_report(p_from timestamptz,p_until timestamptz)
returns table(membership_id uuid,nickname text,present bigint,absent bigint,excused bigint,excluded bigint,percentage numeric)
language sql stable security definer set search_path='' as $$
 select membership_id,nickname,present,absent,excused,excluded,percentage from public.attendance_category_report(p_from,p_until);
$$;

create or replace function private.period_payroll(g uuid,p_from date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; until_date date;
begin
 if p_from is null or extract(day from p_from)<>15 or p_from<date '2020-01-15' or p_from>current_date then raise exception 'INVALID_PERIOD'; end if;
 until_date:=(p_from+interval '1 month')::date;
 with members as (select id,nickname,joined_at,payout_weight,status from public.memberships where guild_id=g),
 events as (select * from public.events where guild_id=g and status='completed' and deleted_at is null and counts_for_attendance and not inventory_receipt and starts_at>=p_from::timestamp at time zone 'UTC' and starts_at<until_date::timestamp at time zone 'UTC' and starts_at<=now()),
 live_points as (
 select m.id,m.nickname,m.payout_weight,m.status,
 coalesce(sum(coalesce(e.activity_weight,100)) filter(where e.id is not null and coalesce(a.mark,'absent') not in ('excused','excluded')),0)::numeric available,
 coalesce(sum(coalesce(e.activity_weight,100)) filter(where a.mark='present'),0)::numeric present,
 c.prime_total_weight prime_available,c.prime_present_weight prime_present,
 coalesce(sum(coalesce(e.activity_weight,100)) filter(where e.treasury_source='mini_rb' and coalesce(a.mark,'absent') not in ('excused','excluded')),0)::numeric mini_available,
 coalesce(sum(coalesce(e.activity_weight,100)) filter(where e.treasury_source='mini_rb' and a.mark='present'),0)::numeric mini_present,
 count(*) filter(where e.kind='pvp' and coalesce(a.mark,'absent') not in ('excused','excluded'))::numeric pvp_available,
 count(*) filter(where e.kind='pvp' and a.mark='present')::numeric pvp_present,
 c.total_count available_count,c.present_count,c.prime_total_count prime_available_count,c.prime_present_count,c.mini_total_count mini_available_count,c.mini_present_count,c.pvp_total_count pvp_available_count,c.pvp_present_count
 from members m join private.attendance_event_counts(g,p_from::timestamp at time zone 'UTC',until_date::timestamp at time zone 'UTC') c on c.membership_id=m.id left join events e on true left join public.attendance a on a.event_id=e.id and a.membership_id=m.id group by m.id,m.nickname,m.payout_weight,m.status,c.total_count,c.present_count,c.prime_total_count,c.prime_present_count,c.mini_total_count,c.mini_present_count,c.pvp_total_count,c.pvp_present_count,c.prime_total_weight,c.prime_present_weight
 ), points as (
 select * from live_points where not exists(select 1 from public.period_archives where guild_id=g and period_from=p_from)
 union all
 select r.id,r.nickname,r.payout_weight,r.status,r.available,r.present,r.prime_available,r.prime_present,r.mini_available,r.mini_present,r.pvp_available,r.pvp_present,r.available_count,r.present_count,r.prime_available_count,r.prime_present_count,r.mini_available_count,r.mini_present_count,r.pvp_available_count,r.pvp_present_count
 from public.period_archives a cross join lateral jsonb_to_recordset(a.snapshot->'points') r(id uuid,nickname text,payout_weight integer,status text,available numeric,present numeric,prime_available numeric,prime_present numeric,mini_available numeric,mini_present numeric,pvp_available numeric,pvp_present numeric,available_count bigint,present_count bigint,prime_available_count bigint,prime_present_count bigint,mini_available_count bigint,mini_present_count bigint,pvp_available_count bigint,pvp_present_count bigint)
 where a.guild_id=g and a.period_from=p_from
), eligible as (select *,present*payout_weight as weight from points where status='active' and coalesce(available_count,available)>0 and coalesce(present_count,present)>0 and coalesce(present_count,present)*5>=coalesce(available_count,available)),
 sales as (select s.* from public.treasury_sales s where s.guild_id=g and s.voided_at is null and s.accounting_period=p_from),
 free_sales as (select s.* from sales s where not exists(select 1 from public.treasury_allocations a where a.sale_id=s.id and a.voided_at is null)),
 funds as (select src,coalesce(sum(s.fund_units),0)::numeric amount from unnest(array['prime','mini_rb']) src left join free_sales s on s.source=src group by src),
 base as (select f.src,m.id,m.weight,f.amount, sum(m.weight) over(partition by f.src) denominator from funds f cross join eligible m),
 shares as (select *,floor(amount*weight/denominator) amount_units,mod(amount*weight,denominator) remainder from base),
 ranked as (select *,row_number() over(partition by src order by remainder desc,id) rank,amount-sum(amount_units) over(partition by src) spare from shares),
 rounded as (select src,id,(amount_units+case when rank<=spare then 1 else 0 end) amount_units from ranked),
 fixed as (select w.membership_id,s.source,sum(w.amount_units)::numeric amount,sum(coalesce((select sum(p.amount_units) from public.treasury_payouts p where p.award_id=w.id and p.voided_at is null),0))::numeric paid from sales s join public.treasury_allocations a on a.sale_id=s.id and a.voided_at is null join public.treasury_awards w on w.allocation_id=a.id group by w.membership_id,s.source),
 rows as (select p.id,p.nickname,p.payout_weight,p.status,
 p.available::text available,p.present::text present,
 p.available_count attendance_total,p.present_count attendance_present,p.prime_available_count prime_total,p.prime_present_count prime_present,p.mini_available_count mini_total,p.mini_present_count mini_present,p.pvp_available_count pvp_total,p.pvp_present_count pvp_present,
 case when coalesce(p.available_count,p.available)>0 then round(100.0*coalesce(p.present_count,p.present)/coalesce(p.available_count,p.available),case when p.available_count is null then 1 else 0 end) when p.available_count is not null then 0 end percentage,
 case when p.prime_available>0 then round(100.0*p.prime_present/p.prime_available,case when p.available_count is null then 1 else 0 end) when p.available_count is not null then 0 end prime_percentage,
 case when coalesce(p.mini_available_count,p.mini_available)>0 then round(100.0*coalesce(p.mini_present_count,p.mini_present)/coalesce(p.mini_available_count,p.mini_available),case when p.available_count is null then 1 else 0 end) when p.available_count is not null then 0 end mini_percentage,
 case when coalesce(p.pvp_available_count,p.pvp_available)>0 then round(100.0*coalesce(p.pvp_present_count,p.pvp_present)/coalesce(p.pvp_available_count,p.pvp_available),case when p.available_count is null then 1 else 0 end) when p.available_count is not null then 0 end pvp_percentage,
 (p.status='active' and coalesce(p.available_count,p.available)>0 and coalesce(p.present_count,p.present)>0 and coalesce(p.present_count,p.present)*5>=coalesce(p.available_count,p.available)) eligible,
 coalesce((select amount_units from rounded where id=p.id and src='prime'),0)::text prime_projection,
 coalesce((select amount_units from rounded where id=p.id and src='mini_rb'),0)::text mini_projection,
 coalesce((select amount-paid from fixed where membership_id=p.id and source='prime'),0)::text prime_fixed,
 coalesce((select amount-paid from fixed where membership_id=p.id and source='mini_rb'),0)::text mini_fixed,
 coalesce((select paid from fixed where membership_id=p.id and source='prime'),0)::text prime_paid,
 coalesce((select paid from fixed where membership_id=p.id and source='mini_rb'),0)::text mini_paid
 from points p)
 select jsonb_build_object('from',p_from,'until',until_date,'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from rows r),'[]'),
 'points',coalesce((select jsonb_agg(to_jsonb(p)) from points p),'[]'), 'sales',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'source',s.source,'amount_units',s.fund_units::text) order by s.id) from free_sales s),'[]'),
 'prime_units',(select amount::text from funds where src='prime'),'mini_units',(select amount::text from funds where src='mini_rb')) into result;
 return result;
end $$;

create or replace function public.rb_purchase_candidates(p_from date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare g uuid;until_date date;result jsonb;
begin
 select id into g from public.guilds where slug='xd';
 if not public.has_permission(g,'members.read') then raise exception 'FORBIDDEN';end if;
 if p_from is null or extract(day from p_from)<>15 or p_from<date '2020-01-15' or p_from>(now() at time zone 'UTC')::date then raise exception 'INVALID_PERIOD';end if;
 until_date:=(p_from+interval '1 month')::date;
 select jsonb_build_object('from',p_from,'until',until_date,'participants',coalesce(jsonb_agg(jsonb_build_object('id',m.id,'nickname',m.nickname,'attendance_tenths',round(100.0*c.mini_present_count/c.mini_total_count)::integer*10) order by m.nickname,m.id),'[]'::jsonb)) into result
 from private.attendance_event_counts(g,p_from::timestamp at time zone 'UTC',until_date::timestamp at time zone 'UTC') c join public.memberships m on m.id=c.membership_id
 where m.status='active' and c.mini_total_count>0 and c.mini_present_count>0 and c.mini_present_count*5>=c.mini_total_count;
 return result;
end $$;

alter function public.dashboard_report(timestamptz,timestamptz) rename to dashboard_report_before_event_counts;
revoke all on function public.dashboard_report_before_event_counts(timestamptz,timestamptz) from public,anon,authenticated;
create function public.dashboard_report(p_from timestamptz,p_until timestamptz) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;g uuid;me uuid;own record;overall numeric;weekly jsonb;
begin
 result:=public.dashboard_report_before_event_counts(p_from,p_until);
 select id into g from public.guilds where slug='xd';
 select id into me from public.memberships where guild_id=g and user_id=private.viewer_id();
 select * into own from private.attendance_event_counts(g,p_from,p_until) where membership_id=me;
 select coalesce(round(100.0*sum(c.present_count)/nullif(sum(c.total_count),0),0),0) into overall from private.attendance_event_counts(g,p_from,p_until) c join public.memberships m on m.id=c.membership_id and m.status='active';
 select coalesce(jsonb_agg(w.value||(select jsonb_build_object('attendance',coalesce(round(100.0*sum(c.present_count)/nullif(sum(c.total_count),0),0),0),'active',count(*) filter(where c.present_count>0)) from private.attendance_event_counts(g,(w.value->>'from')::timestamptz,(w.value->>'until')::timestamptz) c join public.memberships m on m.id=c.membership_id and m.status='active') order by w.ordinality),'[]') into weekly from jsonb_array_elements(result->'weeks') with ordinality w;
 return result||jsonb_build_object('completed_events',own.total_count,'active_members',(select count(*) from private.attendance_event_counts(g,p_from,p_until) c join public.memberships m on m.id=c.membership_id and m.status='active' where c.present_count>0),'attendance',overall,'own_attendance',coalesce(round(100.0*own.present_count/nullif(own.total_count,0),0),0),'own_present',own.present_count,'own_total',own.total_count,'own_prime_percentage',coalesce(round(100.0*own.prime_present_weight/nullif(own.prime_total_weight,0),0),0),'own_mini_percentage',coalesce(round(100.0*own.mini_present_count/nullif(own.mini_total_count,0),0),0),'weeks',weekly);
end $$;
revoke all on function public.dashboard_report(timestamptz,timestamptz) from public,anon;
grant execute on function public.dashboard_report(timestamptz,timestamptz) to authenticated;

-- Telegram and Mini App share the same own-member count; binding/finance ACL unchanged.
create or replace function private.telegram_personal_stats(p_link uuid,p_from timestamptz,p_until timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare me uuid;g uuid;result jsonb;
begin
 select l.membership_id,m.guild_id into me,g from private.telegram_links l join public.memberships m on m.id=l.membership_id
 where l.id=p_link and private.telegram_active(l.membership_id);
 if me is null then return null;end if;
 if p_from is null or p_until is null or not isfinite(p_from) or not isfinite(p_until)
 or p_from>=p_until or p_until-p_from>interval '366 days' then raise exception 'INVALID_PERIOD';end if;
 with attendance as (
  select * from private.attendance_event_counts(g,p_from,p_until) where membership_id=me
 ), awards as (
  select w.id,w.amount_units,a.created_at from public.treasury_awards w join public.treasury_allocations a on a.id=w.allocation_id and a.guild_id=w.guild_id
  where w.guild_id=g and w.membership_id=me and a.voided_at is null
 ), payouts as (
  select p.amount_units,p.created_at from public.treasury_payouts p join awards w on w.id=p.award_id where p.voided_at is null and p.guild_id=g
 ) select jsonb_build_object(
  'period_from',to_char(p_from,'YYYY-MM-DD'),'period_through',to_char(p_until-interval '1 day','YYYY-MM-DD'),
  'present',(select present_count from attendance),
  'applicable',(select total_count from attendance),
  'percentage',coalesce(round(100.0*(select present_count from attendance)/nullif((select total_count from attendance),0),0),0),
  'earned_units',(select coalesce(sum(amount_units),0)::text from awards where created_at>=p_from and created_at<p_until and created_at<=now()),
  'paid_units',(select coalesce(sum(amount_units),0)::text from payouts where created_at>=p_from and created_at<p_until and created_at<=now()),
  'pending_units',((select coalesce(sum(amount_units),0) from awards)-(select coalesce(sum(amount_units),0) from payouts))::text
 ) into result;
 return result;
end $$;


do $$declare r record;h text;begin
 for r in select * from attendance_release_guard loop
 execute format('select md5(coalesce(string_agg(md5(row_to_json(x)::text), %L order by md5(row_to_json(x)::text)),%L)) from public.%I x','','',r.name) into h;
 if h<>r.digest then raise exception 'Protected financial/archive data changed';end if;
 end loop;end $$;
notify pgrst,'reload schema';
commit;
