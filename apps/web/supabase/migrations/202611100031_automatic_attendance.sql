begin;
-- Retain the readiness timestamp for existing reports, without a manual review step.
create function private.complete_saved_attendance(p_event uuid) returns void language plpgsql security definer set search_path='' as $$
declare e public.events;g uuid;actor uuid:=private.viewer_id();changed integer;
begin
 select guild_id into g from public.events where id=p_event;
 if g is null then return; end if;
 perform 1 from public.guilds where id=g for update;
 select * into e from public.events where id=p_event for update;
 if e.id is null or e.status<>'completed' or e.deleted_at is not null or e.inventory_receipt or e.starts_at>now() then return; end if;
 insert into public.attendance(guild_id,event_id,membership_id,mark)
 select e.guild_id,e.id,m.id,case when m.status='active' then 'absent' else 'excluded' end from public.memberships m where m.guild_id=e.guild_id and m.joined_at<=e.starts_at on conflict do nothing;
 with filled as (
  update public.attendance a set mark=case when m.status='active' then 'absent' else 'excluded' end,version=a.version+1,updated_at=now()
  from public.memberships m where a.event_id=e.id and m.id=a.membership_id and a.mark is null returning a.guild_id,a.event_id,a.membership_id,a.mark
 ) insert into public.attendance_revisions(guild_id,event_id,membership_id,old_mark,new_mark,actor_id,reason)
 select guild_id,event_id,membership_id,null,mark,actor,'Автоматический учёт сохранённого состава' from filled where actor is not null;
 get diagnostics changed=row_count;
 if e.attendance_finalized_at is null or changed>0 then
  update public.events set attendance_finalized_at=now(),attendance_finalized_by=actor,version=version+1 where id=e.id;
  insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(e.guild_id,actor,'attendance.automatically_counted',e.id,jsonb_build_object('source','saved_roster','manual_confirmation',false));
 end if;
end $$;
revoke all on function private.complete_saved_attendance(uuid) from public,anon,authenticated;
alter function public.mark_attendance(uuid,uuid,integer,text,text) rename to mark_attendance_before_automatic_count;
revoke all on function public.mark_attendance_before_automatic_count(uuid,uuid,integer,text,text) from public,anon,authenticated;
create function public.mark_attendance(p_event_id uuid,p_membership_id uuid,p_version integer,p_mark text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.mark_attendance_before_automatic_count(p_event_id,p_membership_id,p_version,p_mark,p_reason);
 perform private.complete_saved_attendance(p_event_id);
end $$;
revoke all on function public.mark_attendance(uuid,uuid,integer,text,text) from public,anon;
grant execute on function public.mark_attendance(uuid,uuid,integer,text,text) to authenticated;
create or replace function private.snapshot_event_roster() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='completed' and old.status<>'completed' then
  insert into public.attendance(guild_id,event_id,membership_id,mark)
  select new.guild_id,new.id,m.id,case when m.status='active' then 'absent' else 'excluded' end from public.memberships m where m.guild_id=new.guild_id and m.joined_at<=new.starts_at on conflict do nothing;
  perform private.complete_saved_attendance(new.id);
 end if;
 return new;
end $$;
create or replace function private.apply_activity_details(p_id uuid,p_payload jsonb,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare e public.events; item jsonb; a record; selected uuid[]; full_ids uuid[]; member_id uuid;
 facts jsonb:=coalesce(p_payload->'facts','{}'); guests jsonb:=coalesce(p_payload->'guests','[]');
 images jsonb:=coalesce(p_payload->'evidence','[]'); old_report public.activity_reports;
 b public.guild_activity_banners; weight integer:=(p_payload->>'weight')::integer; source text:=p_payload->>'source';
begin
 p_payload:=p_payload || jsonb_build_object('confirm_roster',true);
 e:=private.lock_managed_event(p_id,'events.manage');
 if e.status='cancelled' then raise exception 'EVENT_CLOSED'; end if;
 if e.inventory_receipt and not public.has_permission(e.guild_id,'treasury.manage') then raise exception 'FORBIDDEN'; end if;
 if char_length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'REASON_REQUIRED'; end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or length(p_payload::text)>4500000 then raise exception 'INVALID_INPUT'; end if;
 if weight is null or weight not between 1 and 100000 or source is null or source not in ('prime','mini_rb','none') then raise exception 'INVALID_INPUT'; end if;
 if coalesce(p_payload->>'difficulty','normal') not in ('normal','hard','heroic') then raise exception 'INVALID_INPUT'; end if;
 if coalesce((p_payload->>'reward_units')::bigint,0) not between 0 and 100000000000000 then raise exception 'INVALID_AMOUNT'; end if;
 if jsonb_typeof(guests) is distinct from 'array' or jsonb_array_length(guests)>50 then raise exception 'INVALID_GUESTS'; end if;
 if exists(select 1 from jsonb_array_elements(guests) x where jsonb_typeof(x) is distinct from 'string' or char_length(btrim(x#>>'{}')) not between 1 and 80) then raise exception 'INVALID_GUESTS'; end if;
 if jsonb_typeof(facts) is distinct from 'object' or coalesce(facts->>'pvp_result','none') not in ('none','win','loss','draw') then raise exception 'INVALID_FACTS'; end if;
 if exists(select 1 from jsonb_array_elements_text(coalesce(facts->'full_participation','[]')) x where not (case when p_payload ? 'members' then (p_payload->'members') ? x else exists(select 1 from public.attendance t where t.event_id=e.id and t.membership_id=x::uuid and t.mark='present') end)) then raise exception 'INVALID_FACTS'; end if;
 foreach member_id in array array_remove(array[(facts->>'organizer')::uuid,(facts->>'raid_leader')::uuid],null) loop
  if not exists(select 1 from public.memberships m where m.id=member_id and m.guild_id=e.guild_id) then raise exception 'INVALID_FACTS'; end if;
 end loop;
 if e.status<>'completed' and (coalesce((facts->>'boss_defeated')::boolean,false) or coalesce(facts->>'pvp_result','none')<>'none' or jsonb_array_length(coalesce(facts->'full_participation','[]'))>0) then raise exception 'INVALID_FACTS'; end if;
 if source<>e.treasury_source and exists(select 1 from public.treasury_loot where event_id=e.id) then raise exception 'SOURCE_LOCKED'; end if;
 if char_length(btrim(coalesce(p_payload->>'title',e.title))) not between 3 and 120 then raise exception 'INVALID_INPUT'; end if;
 if coalesce(p_payload->>'kind',e.kind) not in ('raid','pvp','siege','farm','guild') then raise exception 'INVALID_INPUT'; end if;
 select * into old_report from public.activity_reports where event_id=e.id;
 if nullif(p_payload->>'banner','') is not null then
 select * into b from public.guild_activity_banners where id=(p_payload->>'banner')::uuid and guild_id=e.guild_id for share;
 if b.id is null or b.version is distinct from (p_payload->>'banner_version')::integer then raise exception 'CATALOG_STALE'; end if;
 end if;
 update public.events set title=btrim(coalesce(p_payload->>'title',title)),kind=coalesce(p_payload->>'kind',kind),treasury_source=source,activity_weight=weight,counts_for_attendance=coalesce((p_payload->>'counts')::boolean,counts_for_attendance),activity_banner_id=coalesce(b.id,activity_banner_id),activity_banner_name=coalesce(b.name,activity_banner_name),activity_banner_photo=coalesce(b.photo,activity_banner_photo),
 attendance_finalized_at=case when activity_weight is distinct from weight or kind is distinct from coalesce(p_payload->>'kind',kind) or treasury_source is distinct from source or (b.id is not null and b.id is distinct from activity_banner_id) then null else attendance_finalized_at end,
 attendance_finalized_by=case when activity_weight is distinct from weight or kind is distinct from coalesce(p_payload->>'kind',kind) or treasury_source is distinct from source or (b.id is not null and b.id is distinct from activity_banner_id) then null else attendance_finalized_by end,
 version=version+1 where id=e.id;
 insert into public.activity_reports(event_id,guild_id,difficulty,is_night,attendance_reward_units,guests,facts)
 values(e.id,e.guild_id,coalesce(p_payload->>'difficulty','normal'),coalesce((p_payload->>'night')::boolean,false),coalesce((p_payload->>'reward_units')::bigint,0),guests,facts)
 on conflict(event_id) do update set difficulty=excluded.difficulty,is_night=excluded.is_night,attendance_reward_units=excluded.attendance_reward_units,guests=excluded.guests,facts=excluded.facts;
 if p_payload ? 'members' then
  if not public.has_permission(e.guild_id,'attendance.manage') then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(p_payload->'members') is distinct from 'array' or jsonb_array_length(p_payload->'members')>500 then raise exception 'INVALID_ROSTER'; end if;
  select coalesce(array_agg(distinct x::uuid),'{}'::uuid[]) into selected from jsonb_array_elements_text(p_payload->'members') x;
  if exists(select 1 from unnest(selected) x where not exists(select 1 from public.memberships m where m.id=x and m.guild_id=e.guild_id and m.status='active' and m.joined_at<=e.starts_at)) then raise exception 'INVALID_ROSTER'; end if;
  if e.status='completed' then
   for a in select t.*,m.status as member_status from public.attendance t join public.memberships m on m.id=t.membership_id where t.event_id=e.id loop
    if a.membership_id=any(selected) then
     perform public.mark_attendance_before_automatic_count(e.id,a.membership_id,a.version,'present',p_reason);
    elsif coalesce((p_payload->>'confirm_roster')::boolean,false) and a.mark is distinct from 'excused' and a.mark is distinct from 'excluded' then
     perform public.mark_attendance_before_automatic_count(e.id,a.membership_id,a.version,case when a.member_status='active' then 'absent' else 'excluded' end,p_reason);
    elsif a.mark='present' then
     perform public.mark_attendance_before_automatic_count(e.id,a.membership_id,a.version,'absent',p_reason);
    end if;
   end loop;
   if coalesce((p_payload->>'confirm_roster')::boolean,false) then
    select version into e.version from public.events where id=e.id;
    perform private.complete_saved_attendance(e.id);
   end if;
  else
   delete from public.event_signups where event_id=e.id;
   insert into public.event_signups(guild_id,event_id,membership_id) select e.guild_id,e.id,x from unnest(selected) x;
  end if;
 end if;
 if jsonb_typeof(images) is distinct from 'array' or jsonb_array_length(images)>8 then raise exception 'INVALID_EVIDENCE'; end if;
 if p_payload ? 'remove_evidence' then
  for item in select value from jsonb_array_elements(p_payload->'remove_evidence') loop
   if exists(select 1 from public.activity_evidence v where v.id=(item#>>'{}')::uuid and (v.event_id<>e.id or v.guild_id<>e.guild_id)) then raise exception 'FORBIDDEN'; end if;
   if exists(select 1 from public.activity_evidence v where v.id=(item#>>'{}')::uuid and ((v.kind='roster' and not public.has_permission(e.guild_id,'attendance.manage')) or(v.kind='loot' and not private.can_manage_activity_loot(e.guild_id)))) then raise exception 'FORBIDDEN'; end if;
   delete from public.activity_evidence where id=(item#>>'{}')::uuid and event_id=e.id;
  end loop;
 end if;
 for item in select value from jsonb_array_elements(images) loop
  if item->>'kind' not in ('roster','loot') or item->>'kind' is null then raise exception 'INVALID_EVIDENCE'; end if;
  if (item->>'kind'='roster' and not public.has_permission(e.guild_id,'attendance.manage')) or (item->>'kind'='loot' and not private.can_manage_activity_loot(e.guild_id)) then raise exception 'FORBIDDEN'; end if;
  insert into public.activity_evidence(id,guild_id,event_id,kind,image) values((item->>'id')::uuid,e.guild_id,e.id,item->>'kind',item->>'image');
 end loop;
 if (select count(*) from public.activity_evidence where event_id=e.id)>8 then raise exception 'TOO_MANY_IMAGES'; end if;
 perform private.complete_saved_attendance(e.id);
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(e.guild_id,private.viewer_id(),'activity.report_saved',e.id,jsonb_build_object('reason',p_reason,'before',to_jsonb(old_report),'difficulty',p_payload->>'difficulty','night',p_payload->'night','coefficient',weight,'previous_event',jsonb_build_object('title',e.title,'kind',e.kind,'weight',e.activity_weight,'source',e.treasury_source,'banner',e.activity_banner_id)));
end $$;
revoke all on function private.apply_activity_details(uuid,jsonb,text) from public,anon,authenticated;



-- Preserve explicit marks; apply automatic accounting to previously saved completed activities.
do $$declare event_id uuid;begin
 for event_id in select id from public.events where status='completed' and deleted_at is null and not inventory_receipt and starts_at<=now() and attendance_finalized_at is null loop
  perform private.complete_saved_attendance(event_id);
 end loop;
end $$;
commit;
