begin;
insert into public.permissions(key) values('activities.loot') on conflict do nothing;
insert into public.roles(guild_id,code,name) select id,v.code,v.name from public.guilds cross join (values ('guild_master','Гильд мастер'),('tablemaker','Таблицмейкер')) v(code,name) on conflict(guild_id,code) do nothing;
insert into public.role_permissions(role_id,permission) select id,'activities.loot' from public.roles where code in ('owner','admin') on conflict do nothing;
insert into public.role_permissions(role_id,permission) select id,p from public.roles cross join unnest(array['members.read','events.manage','attendance.manage','activities.loot']) p where code='tablemaker' on conflict do nothing;
insert into public.role_permissions(role_id,permission) select gm.id,rp.permission from public.roles gm join public.roles a on a.guild_id=gm.guild_id and a.code='admin' join public.role_permissions rp on rp.role_id=a.id where gm.code='guild_master' on conflict do nothing;
-- Guild masters follow the actual admin permission set, including future changes.
create or replace function public.has_permission(guild uuid, permission text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships m join public.membership_roles mr on mr.membership_id=m.id and mr.guild_id=m.guild_id
 join public.roles assigned on assigned.id=mr.role_id and assigned.guild_id=m.guild_id
 join public.roles effective on effective.guild_id=m.guild_id and effective.code=case when assigned.code='guild_master' then 'admin' else assigned.code end
 join public.role_permissions rp on rp.role_id=effective.id
 where m.guild_id=$1 and m.user_id=private.viewer_id() and m.status='active' and rp.permission=$2)
$$;
create function private.can_manage_activity_loot(g uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.has_permission(g,'treasury.manage') or public.has_permission(g,'activities.loot')
$$;
revoke all on function private.can_manage_activity_loot(uuid) from public,anon;
grant execute on function private.can_manage_activity_loot(uuid) to authenticated;
drop policy drop_registry_read on public.guild_drop_registry;
create policy drop_registry_read on public.guild_drop_registry for select to authenticated using(public.has_permission(guild_id,'drops.manage') or private.can_manage_activity_loot(guild_id));
create policy activity_loot_read on public.treasury_loot for select to authenticated using(public.has_permission(guild_id,'activities.loot') and exists(select 1 from public.events e where e.id=event_id and e.guild_id=public.treasury_loot.guild_id and not e.inventory_receipt));
drop policy activity_evidence_read on public.activity_evidence;
create policy activity_evidence_read on public.activity_evidence for select to authenticated using((kind='roster' and public.has_permission(guild_id,'attendance.manage')) or (kind='loot' and (public.has_permission(guild_id,'treasury.read') or public.has_permission(guild_id,'activities.loot'))));
create or replace function private.apply_activity_details(p_id uuid,p_payload jsonb,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare e public.events; item jsonb; a record; selected uuid[]; full_ids uuid[]; member_id uuid;
 facts jsonb:=coalesce(p_payload->'facts','{}'); guests jsonb:=coalesce(p_payload->'guests','[]');
 images jsonb:=coalesce(p_payload->'evidence','[]'); old_report public.activity_reports;
 b public.guild_activity_banners; weight integer:=(p_payload->>'weight')::integer; source text:=p_payload->>'source';
begin
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
     perform public.mark_attendance(e.id,a.membership_id,a.version,'present',p_reason);
    elsif coalesce((p_payload->>'confirm_roster')::boolean,false) and a.mark is distinct from 'excused' and a.mark is distinct from 'excluded' then
     perform public.mark_attendance(e.id,a.membership_id,a.version,case when a.member_status='active' then 'absent' else 'excluded' end,p_reason);
    elsif a.mark='present' then
     perform public.mark_attendance(e.id,a.membership_id,a.version,'absent',p_reason);
    end if;
   end loop;
   if coalesce((p_payload->>'confirm_roster')::boolean,false) then
    select version into e.version from public.events where id=e.id;
    perform public.finalize_attendance(e.id,e.version);
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
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(e.guild_id,private.viewer_id(),'activity.report_saved',e.id,jsonb_build_object('reason',p_reason,'before',to_jsonb(old_report),'difficulty',p_payload->>'difficulty','night',p_payload->'night','coefficient',weight,'previous_event',jsonb_build_object('title',e.title,'kind',e.kind,'weight',e.activity_weight,'source',e.treasury_source,'banner',e.activity_banner_id)));
end $$;
revoke all on function private.apply_activity_details(uuid,jsonb,text) from public,anon,authenticated;


create or replace function public.add_activity_drop(p_event uuid,p_catalog uuid,p_catalog_version integer,p_quantity integer,p_request uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare e public.events;c public.guild_drop_registry;existing public.treasury_loot;g uuid;
begin
 select guild_id into g from public.events where id=p_event;
 perform private.lock_finance(g,case when public.has_permission(g,'treasury.manage') then 'treasury.manage' else 'activities.loot' end);
 select * into e from public.events where id=p_event for update;
 if e.inventory_receipt or e.deleted_at is not null then raise exception 'FORBIDDEN'; end if;
 if e.status<>'completed' or e.starts_at>now() then raise exception 'EVENT_NOT_COMPLETED'; end if;
 if e.treasury_source='none' then raise exception 'SOURCE_REQUIRED'; end if;
 if p_request is null or p_quantity is null or p_quantity not between 1 and 1000000 then raise exception 'INVALID_QUANTITY'; end if;
 select * into existing from public.treasury_loot where id=p_request;
 if existing.id is not null then
  if existing.guild_id=g and existing.event_id=e.id and existing.catalog_id=p_catalog and existing.quantity_total=p_quantity then return existing.id; end if;
  raise exception 'REQUEST_CONFLICT';
 end if;
 select * into c from public.guild_drop_registry where id=p_catalog and guild_id=g for share;
 if c.id is null or c.version is distinct from p_catalog_version then raise exception 'CATALOG_STALE'; end if;
 insert into public.treasury_loot(id,guild_id,event_id,source,name,category,quantity_total,quantity_remaining,estimated_unit_units,note,created_by,catalog_id,catalog_photo)
 values(p_request,g,e.id,e.treasury_source,c.name,'Дроп активности',p_quantity,p_quantity,c.price_units,'Из реестра дропа',private.viewer_id(),c.id,c.photo);
 update public.events set version=version+1 where id=e.id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'treasury.loot_added',p_request,jsonb_build_object('event_id',e.id,'source',e.treasury_source,'quantity',p_quantity,'estimated_unit_units',c.price_units));
 return p_request;
end $$;
create or replace function public.remove_activity_drop(p_id uuid,p_version integer,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare l public.treasury_loot;
begin
 select * into l from public.treasury_loot where id=p_id;
 perform private.lock_finance(l.guild_id,case when public.has_permission(l.guild_id,'treasury.manage') then 'treasury.manage' else 'activities.loot' end);
 select * into l from public.treasury_loot where id=p_id for update;
 if exists(select 1 from public.events where id=l.event_id and inventory_receipt) then raise exception 'FORBIDDEN'; end if;
 if l.version is distinct from p_version then raise exception 'STALE_VERSION'; end if;
 if char_length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'REASON_REQUIRED'; end if;
 if exists(select 1 from public.treasury_sales where loot_id=l.id) then raise exception 'LOOT_HAS_HISTORY'; end if;
 delete from public.treasury_loot where id=l.id;
 update public.events set version=version+1 where id=l.event_id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(l.guild_id,private.viewer_id(),'activity.loot_removed',l.id,jsonb_build_object('reason',p_reason,'before',to_jsonb(l)));
end $$;
create or replace function public.activity_detail(p_event uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e public.events;r public.activity_reports;staff boolean;money boolean;result jsonb;actor uuid:=private.viewer_id();
begin
 select * into e from public.events where id=p_event;
 if e.id is null or not private.is_member(e.guild_id) then raise exception 'FORBIDDEN'; end if;
 if e.inventory_receipt and not public.has_permission(e.guild_id,'treasury.read') then raise exception 'FORBIDDEN'; end if;
 staff:=public.has_permission(e.guild_id,'attendance.manage');money:=public.has_permission(e.guild_id,'treasury.read') or public.has_permission(e.guild_id,'activities.loot');
 select * into r from public.activity_reports where event_id=e.id;
 select jsonb_build_object(
 'event',jsonb_build_object('id',e.id,'title',e.title,'starts_at',e.starts_at,'kind',e.kind,'status',e.status,'source',e.treasury_source,'journal_status',private.activity_journal_status(e.id),'version',e.version,'weight',coalesce(e.activity_weight,100),'banner',e.activity_banner_id,'has_banner',coalesce(e.activity_banner_photo,'')<>'','finalized',e.attendance_finalized_at is not null,'description',e.description,'counts',e.counts_for_attendance),
 'report',jsonb_build_object('difficulty',coalesce(r.difficulty,'normal'),'night',coalesce(r.is_night,false),'reward_units',case when money then coalesce(r.attendance_reward_units,0)::text else null end,'guests',case when staff then coalesce(r.guests,'[]') else '[]'::jsonb end,'facts',case when staff then coalesce(r.facts,'{}') else coalesce(r.facts,'{}')-'full_participation'-'organizer'-'raid_leader' end),
 'can_view_roster',staff,
 'roster',case when staff then coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'nickname',m.nickname,'character_class',c.character_class,'mark',a.mark) order by m.nickname,m.id) from public.attendance a join public.memberships m on m.id=a.membership_id left join public.characters c on c.membership_id=m.id and c.is_main and c.archived_at is null where a.event_id=e.id and a.mark='present'),'[]') else '[]'::jsonb end,
 'selected_members',case when staff then case when e.status='scheduled' then coalesce((select jsonb_agg(s.membership_id) from public.event_signups s where s.event_id=e.id),'[]') else coalesce((select jsonb_agg(a.membership_id) from public.attendance a where a.event_id=e.id and a.mark='present'),'[]') end else '[]'::jsonb end,
 'participants',case when staff then case when e.status='scheduled' then (select count(*) from public.event_signups s where s.event_id=e.id) else (select count(*) from public.attendance a where a.event_id=e.id and a.mark='present') end end,
 'loot',case when money then coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'quantity',l.quantity_total,'remaining',l.quantity_remaining,'unit_units',l.estimated_unit_units::text,'total_units',(l.quantity_total::numeric*l.estimated_unit_units)::text,'has_photo',l.catalog_photo<>'','version',l.version,'has_history',exists(select 1 from public.treasury_sales s where s.loot_id=l.id)) order by l.created_at,l.id) from public.treasury_loot l where l.event_id=e.id),'[]') else '[]'::jsonb end,
 'loot_total_units',case when money then (select coalesce(sum(l.quantity_total::numeric*l.estimated_unit_units),0)::text from public.treasury_loot l where l.event_id=e.id) end,
 'unpriced_count',case when money then (select count(*) from public.treasury_loot l where l.event_id=e.id and l.estimated_unit_units is null) end,
 'evidence',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'kind',v.kind) order by v.created_at,v.id) from public.activity_evidence v where v.event_id=e.id and ((v.kind='roster' and staff) or(v.kind='loot' and money))),'[]')
 ) into result;
 return result;
end $$;

commit;
