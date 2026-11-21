-- Read-only lifetime attendance. No reset, allocation or payout mutation.
begin;
create function public.all_time_attendance_report()
returns table(id uuid,nickname text,status text,percentage numeric,prime_percentage numeric,mini_percentage numeric,pvp_percentage numeric,attendance_total bigint,attendance_present bigint,prime_total bigint,prime_present bigint,mini_total bigint,mini_present bigint,pvp_total bigint,pvp_present bigint,excused bigint,excluded bigint,absent bigint,eligible boolean)
language plpgsql stable security definer set search_path='' as $$
declare g uuid; actor uuid:=private.viewer_id(); full_read boolean;
begin
 select m.guild_id into g from public.memberships m where m.user_id=actor and m.status='active' limit 1;
 if actor is null or g is null or not private.is_member(g) then raise exception 'FORBIDDEN'; end if;
 full_read:=public.has_permission(g,'members.read') or public.has_permission(g,'attendance.manage') or private.finance_staff(g);
 return query
 select m.id,m.nickname,m.status::text,
 coalesce(round(100.0*c.present_count/nullif(c.total_count,0)),0),
 coalesce(round(100.0*c.prime_present_weight/nullif(c.prime_total_weight,0)),0),
 coalesce(round(100.0*c.mini_present_count/nullif(c.mini_total_count,0)),0),
 coalesce(round(100.0*c.pvp_present_count/nullif(c.pvp_total_count,0)),0),
 c.total_count,c.present_count,c.prime_total_count,c.prime_present_count,c.mini_total_count,c.mini_present_count,c.pvp_total_count,c.pvp_present_count,c.excused_count,c.excluded_count,
 c.total_count-c.present_count-c.excused_count-c.excluded_count,
 (m.status='active' and c.total_count>0 and c.present_count>0 and c.present_count*5>=c.total_count)
 from private.attendance_event_counts(g,'-infinity'::timestamptz,'infinity'::timestamptz) c
 join public.memberships m on m.id=c.membership_id and m.guild_id=g
 where full_read or m.user_id=actor order by m.nickname,m.id;
end $$;
revoke all on function public.all_time_attendance_report() from public,anon;
grant execute on function public.all_time_attendance_report() to authenticated;
notify pgrst,'reload schema';
commit;
