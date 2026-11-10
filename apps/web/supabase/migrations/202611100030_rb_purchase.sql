begin;
-- Read-only attendance report; experience calculations do not write to the ledger.
create function public.rb_purchase_candidates(p_from date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare g uuid;until_date date;result jsonb;
begin
 select id into g from public.guilds where slug='xd';
 if not public.has_permission(g,'members.read') then raise exception 'FORBIDDEN'; end if;
 if p_from is null or extract(day from p_from)<>15 or p_from<date '2020-01-15' or p_from>(now() at time zone 'UTC')::date then raise exception 'INVALID_PERIOD'; end if;
 until_date:=(p_from+interval '1 month')::date;
 with events as (
  select * from public.events where guild_id=g and status='completed' and deleted_at is null and not inventory_receipt and treasury_source='mini_rb' and counts_for_attendance and attendance_finalized_at is not null and starts_at>=p_from::timestamp at time zone 'UTC' and starts_at<until_date::timestamp at time zone 'UTC' and starts_at<=now()
 ), points as (
  select m.id,m.nickname,
   coalesce(sum(coalesce(e.activity_weight,100)) filter(where e.id is not null and coalesce(a.mark,'absent') not in ('excused','excluded')),0)::numeric available,
   coalesce(sum(coalesce(e.activity_weight,100)) filter(where a.mark='present'),0)::numeric present
  from public.memberships m left join events e on (m.joined_at<=e.starts_at or exists(select 1 from public.attendance x where x.event_id=e.id and x.membership_id=m.id))
  left join public.attendance a on a.event_id=e.id and a.membership_id=m.id
  where m.guild_id=g and m.status='active' group by m.id,m.nickname
 ), eligible as (
  select id,nickname,round(1000*present/available)::integer attendance_tenths from points where available>0 and present>0 and present*5>=available
 )
 select jsonb_build_object('from',p_from,'until',until_date,'participants',coalesce((select jsonb_agg(to_jsonb(e) order by e.nickname,e.id) from eligible e),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.rb_purchase_candidates(date) from public,anon;
grant execute on function public.rb_purchase_candidates(date) to authenticated;
commit;
