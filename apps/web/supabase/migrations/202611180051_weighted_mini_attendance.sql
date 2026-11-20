begin;
create function private.weighted_attendance_event_counts(g uuid,p_from timestamptz,p_until timestamptz)
returns table(membership_id uuid,total_count bigint,present_count bigint,prime_total_count bigint,prime_present_count bigint,mini_total_count bigint,mini_present_count bigint,pvp_total_count bigint,pvp_present_count bigint,excused_count bigint,excluded_count bigint,prime_total_weight numeric,prime_present_weight numeric,mini_total_weight numeric,mini_present_weight numeric)
language sql stable security definer set search_path='' as $$
 with events as materialized (
 select e.id,coalesce(e.activity_weight,100)::numeric weight from private.current_events e
 where e.guild_id=g and e.status='completed' and e.deleted_at is null and not e.inventory_receipt and e.counts_for_attendance
 and e.starts_at>=p_from and e.starts_at<p_until and e.starts_at<=now()
 and private.attendance_bucket(coalesce(nullif(e.activity_banner_name,''),e.title),e.kind)='mini_rb'
 ), marks as (
 select a.membership_id,sum(e.weight) weight from events e join public.attendance a on a.event_id=e.id and a.guild_id=g and a.mark='present' group by a.membership_id
 )
 select c.*,coalesce((select sum(weight) from events),0),coalesce(m.weight,0)
 from private.attendance_event_counts(g,p_from,p_until) c left join marks m on m.membership_id=c.membership_id;
$$;
revoke all on function private.weighted_attendance_event_counts(uuid,timestamptz,timestamptz) from public,anon,authenticated;
-- Update live readers without dropping RPC signatures, grants or historical snapshots.
do $migration$
declare signature text;definition text;
begin
 foreach signature in array array[
 'public.attendance_category_report(timestamptz,timestamptz)',
 'public.all_time_attendance_report()',
 'public.dashboard_report(timestamptz,timestamptz)',
 'public.rb_purchase_candidates(date)',
 'public.archive_activities(uuid,date,date)',
 'private.period_payroll(uuid,date)',
 'private.lifetime_payroll_before_categories(uuid)'
 ] loop
 definition:=pg_get_functiondef(signature::regprocedure);
 if position('private.attendance_event_counts(' in definition)=0 then raise exception 'EXPECTED_ATTENDANCE_READER_MISSING: %',signature;end if;
 definition:=replace(definition,'private.attendance_event_counts(','private.weighted_attendance_event_counts(');
 definition:=replace(definition,'c.mini_present_count/nullif(c.mini_total_count,0)','c.mini_present_weight/nullif(c.mini_total_weight,0)');
 definition:=replace(definition,'own.mini_present_count/nullif(own.mini_total_count,0)','own.mini_present_weight/nullif(own.mini_total_weight,0)');
 if signature='public.rb_purchase_candidates(date)' then
  definition:=replace(definition,'c.mini_present_count','c.mini_present_weight');
  definition:=replace(definition,'c.mini_total_count','c.mini_total_weight');
 end if;
 if signature in ('private.period_payroll(uuid,date)','private.lifetime_payroll_before_categories(uuid)') then
  definition:=replace(definition,
   $old$coalesce(sum(coalesce(e.activity_weight,100)) filter(where e.treasury_source='mini_rb' and coalesce(a.mark,'absent') not in ('excused','excluded')),0)::numeric mini_available$old$,
   'c.mini_total_weight mini_available');
  definition:=replace(definition,
   $old$coalesce(sum(coalesce(e.activity_weight,100)) filter(where e.treasury_source='mini_rb' and a.mark='present'),0)::numeric mini_present$old$,
   'c.mini_present_weight mini_present');
  definition:=replace(definition,'c.prime_total_weight,c.prime_present_weight'||chr(10),'c.prime_total_weight,c.prime_present_weight,c.mini_total_weight,c.mini_present_weight'||chr(10));
  definition:=replace(definition,'coalesce(p.mini_available_count,p.mini_available)','p.mini_available');
  definition:=replace(definition,'coalesce(p.mini_present_count,p.mini_present)','p.mini_present');
 end if;
 execute definition;
 end loop;
 definition:=pg_get_functiondef('private.lifetime_payroll(uuid)'::regprocedure);
 if position('mini_available_count' in definition)=0 then raise exception 'EXPECTED_SALARY_READER_MISSING';end if;
 definition:=replace(definition,'mini_available_count','mini_available');
 definition:=replace(definition,'mini_present_count','mini_present');
 definition:=replace(definition,'live_categories_v1','live_categories_weighted_v2');
 execute definition;
end $migration$;
notify pgrst,'reload schema';
commit;
