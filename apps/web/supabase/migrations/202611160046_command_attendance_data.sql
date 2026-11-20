-- One authorized snapshot replaces per-row RLS scans and repeated HTTP pages.
begin;
create function public.command_attendance_data(p_from timestamptz,p_until timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare g uuid;actor uuid:=private.viewer_id();full_read boolean;result jsonb;n bigint;
begin
 select m.guild_id into g from public.memberships m where m.user_id=actor and m.status='active' limit 1;
 if actor is null or g is null or not private.is_member(g) then raise exception 'FORBIDDEN';end if;
 if p_from is null or p_until is null or not isfinite(p_from) or not isfinite(p_until) or p_from>=p_until then raise exception 'INVALID_PERIOD';end if;
 full_read:=public.has_permission(g,'attendance.manage');
 select count(*) into n from public.events e where e.guild_id=g and e.status='completed' and e.counts_for_attendance and not e.inventory_receipt and e.deleted_at is null and e.starts_at>=p_from and e.starts_at<p_until and e.starts_at<=now();
 if n>10000 then raise exception 'REPORT_TOO_LARGE';end if;
 select count(*) into n from public.attendance a join public.events e on e.id=a.event_id and e.guild_id=a.guild_id join public.memberships m on m.id=a.membership_id and m.guild_id=a.guild_id
 where a.guild_id=g and a.mark='present' and m.status='active' and (full_read or m.user_id=actor) and e.status='completed' and e.counts_for_attendance and not e.inventory_receipt and e.deleted_at is null and e.starts_at>=p_from and e.starts_at<p_until and e.starts_at<=now();
 if n>100000 then raise exception 'REPORT_TOO_LARGE';end if;
 with events as (
 select e.id,e.title,e.kind,e.starts_at,e.status,e.counts_for_attendance,e.attendance_finalized_at,e.treasury_source,e.activity_weight,e.activity_banner_name,e.deleted_at,e.inventory_receipt
 from public.events e where e.guild_id=g and e.status='completed' and e.counts_for_attendance and not e.inventory_receipt and e.deleted_at is null and e.starts_at>=p_from and e.starts_at<p_until and e.starts_at<=now()
 ), members as (
 select m.id,m.nickname,m.character_class from public.member_directory m join public.memberships own on own.id=m.id and own.guild_id=m.guild_id where m.guild_id=g and m.status='active' and (full_read or own.user_id=actor)
 ), marks as (
 select a.event_id,a.membership_id,a.mark from public.attendance a join events e on e.id=a.event_id join members m on m.id=a.membership_id where a.guild_id=g and a.mark='present'
 ) select jsonb_build_object('events',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from events e),'[]'),
 'members',coalesce((select jsonb_agg(to_jsonb(m) order by m.id) from members m),'[]'),
 'marks',coalesce((select jsonb_agg(to_jsonb(a) order by a.event_id,a.membership_id) from marks a),'[]')) into result;
 return result;
end $$;
revoke all on function public.command_attendance_data(timestamptz,timestamptz) from public,anon;
grant execute on function public.command_attendance_data(timestamptz,timestamptz) to authenticated;
notify pgrst,'reload schema';
commit;
