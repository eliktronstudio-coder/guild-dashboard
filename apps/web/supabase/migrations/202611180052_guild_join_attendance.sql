begin;
-- Unknown historical dates stay unknown; registration time is never substituted.
alter table public.memberships add column guild_joined_on date check(guild_joined_on>=date '2020-01-01'),add column guild_join_version integer not null default 1 check(guild_join_version>0);
create function public.set_guild_join_date(p_member uuid,p_version integer,p_date date,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare m public.memberships;
begin
 select * into m from public.memberships where id=p_member;
 perform private.lock_finance(m.guild_id,'members.manage');
 select * into m from public.memberships where id=p_member for update;
 if exists(select 1 from public.membership_roles mr join public.roles r on r.id=mr.role_id and r.code='owner' where mr.membership_id=m.id) and m.user_id<>private.viewer_id() then raise exception 'FORBIDDEN';end if;
 if m.guild_join_version is distinct from p_version then raise exception 'STALE_VERSION';end if;
 if (p_date is not null and (not isfinite(p_date) or p_date<date '2020-01-01' or p_date>(now() at time zone 'UTC')::date)) or char_length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'INVALID_INPUT';end if;
 update public.memberships set guild_joined_on=p_date,guild_join_version=guild_join_version+1 where id=m.id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(m.guild_id,private.viewer_id(),'member.guild_join_date',m.id,jsonb_build_object('nickname',m.nickname,'before',m.guild_joined_on,'after',p_date,'reason',btrim(p_reason)));
end $$;
revoke all on function public.set_guild_join_date(uuid,integer,date,text) from public,anon;
grant execute on function public.set_guild_join_date(uuid,integer,date,text) to authenticated;

create or replace function private.attendance_event_counts(g uuid,p_from timestamptz,p_until timestamptz)
returns table(membership_id uuid,total_count bigint,present_count bigint,prime_total_count bigint,prime_present_count bigint,mini_total_count bigint,mini_present_count bigint,pvp_total_count bigint,pvp_present_count bigint,excused_count bigint,excluded_count bigint,prime_total_weight numeric,prime_present_weight numeric)
language sql stable security definer set search_path='' as $$
 with events as materialized (
 select e.id,e.starts_at,e.kind,private.attendance_bucket(coalesce(nullif(e.activity_banner_name,''),e.title),e.kind) category,coalesce(e.activity_weight,100)::numeric weight
 from private.current_events e where e.guild_id=g and e.status='completed' and e.deleted_at is null and not e.inventory_receipt and e.counts_for_attendance
 and e.starts_at>=p_from and e.starts_at<p_until and e.starts_at<=now()
 )
 select m.id,count(e.id),count(e.id) filter(where a.mark='present'),
 count(e.id) filter(where e.category='prime'),count(e.id) filter(where e.category='prime' and a.mark='present'),
 count(e.id) filter(where e.category='mini_rb'),count(e.id) filter(where e.category='mini_rb' and a.mark='present'),
 count(e.id) filter(where e.kind='pvp'),count(e.id) filter(where e.kind='pvp' and a.mark='present'),
 count(e.id) filter(where a.mark='excused'),count(e.id) filter(where a.mark='excluded'),
 coalesce(sum(e.weight) filter(where e.category='prime'),0),coalesce(sum(e.weight) filter(where e.category='prime' and a.mark='present'),0)
 from public.memberships m left join events e on (m.guild_joined_on is null or e.starts_at>=m.guild_joined_on::timestamp at time zone 'UTC')
 left join public.attendance a on a.guild_id=g and a.event_id=e.id and a.membership_id=m.id where m.guild_id=g group by m.id;
$$;
create or replace function private.weighted_attendance_event_counts(g uuid,p_from timestamptz,p_until timestamptz)
returns table(membership_id uuid,total_count bigint,present_count bigint,prime_total_count bigint,prime_present_count bigint,mini_total_count bigint,mini_present_count bigint,pvp_total_count bigint,pvp_present_count bigint,excused_count bigint,excluded_count bigint,prime_total_weight numeric,prime_present_weight numeric,mini_total_weight numeric,mini_present_weight numeric)
language sql stable security definer set search_path='' as $$
 with events as materialized (
 select e.id,e.starts_at,coalesce(e.activity_weight,100)::numeric weight from private.current_events e
 where e.guild_id=g and e.status='completed' and e.deleted_at is null and not e.inventory_receipt and e.counts_for_attendance
 and e.starts_at>=p_from and e.starts_at<p_until and e.starts_at<=now()
 and private.attendance_bucket(coalesce(nullif(e.activity_banner_name,''),e.title),e.kind)='mini_rb'
 ), weights as (
 select m.id,coalesce(sum(e.weight),0) total,coalesce(sum(e.weight) filter(where a.mark='present'),0) present
 from public.memberships m left join events e on (m.guild_joined_on is null or e.starts_at>=m.guild_joined_on::timestamp at time zone 'UTC')
 left join public.attendance a on a.guild_id=g and a.event_id=e.id and a.membership_id=m.id where m.guild_id=g group by m.id
 )
 select c.*,w.total,w.present from private.attendance_event_counts(g,p_from,p_until) c join weights w on w.id=c.membership_id;
$$;
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.command_attendance_data(timestamptz,timestamptz)'::regprocedure);
 if position('select m.id,m.nickname,m.character_class from' in definition)=0 then raise exception 'EXPECTED_MEMBER_READER_MISSING';end if;
 execute replace(definition,'select m.id,m.nickname,m.character_class from','select m.id,m.nickname,m.character_class,own.guild_joined_on from');
 definition:=pg_get_functiondef('public.archive_activities(uuid,date,date)'::regprocedure);
 execute replace(definition,$old$jsonb_build_object('nickname',m.nickname)$old$,$new$jsonb_build_object('nickname',m.nickname,'guild_joined_on',m.guild_joined_on)$new$);
end $$;
-- Keep existing view columns/ACL and append the explicit guild date.
do $$declare definition text;begin
 definition:=regexp_replace(pg_get_viewdef('public.member_directory'::regclass,true),';[[:space:]]*$','');
 execute 'create or replace view public.member_directory with (security_invoker=true) as select directory.*,member.guild_joined_on from ('||definition||') directory join public.memberships member on member.id=directory.id and member.guild_id=directory.guild_id';
end $$;
notify pgrst,'reload schema';
commit;
