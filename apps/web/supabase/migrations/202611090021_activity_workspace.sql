begin;
create table public.activity_reports (
 event_id uuid primary key, guild_id uuid not null,
 difficulty text not null default 'normal' check(difficulty in ('normal','hard','heroic')),
 is_night boolean not null default false,
 attendance_reward_units bigint not null default 0 check(attendance_reward_units between 0 and 100000000000000),
 guests jsonb not null default '[]' check(jsonb_typeof(guests)='array' and jsonb_array_length(guests)<=50),
 facts jsonb not null default '{}' check(jsonb_typeof(facts)='object'),
 request_hash text,
 foreign key(guild_id,event_id) references public.events(guild_id,id)
);
create table public.activity_evidence (
 id uuid primary key, guild_id uuid not null,event_id uuid not null,
 kind text not null check(kind in ('roster','loot')),
 image text not null check(length(image)<=500000 and image ~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+$'),
 created_at timestamptz not null default now(),
 foreign key(guild_id,event_id) references public.events(guild_id,id)
);
alter table public.activity_reports enable row level security;
alter table public.activity_evidence enable row level security;
create policy activity_reports_read on public.activity_reports for select to authenticated using(public.has_permission(guild_id,'events.manage') or public.has_permission(guild_id,'attendance.manage') or public.has_permission(guild_id,'treasury.manage'));
create policy activity_evidence_read on public.activity_evidence for select to authenticated using((kind='roster' and public.has_permission(guild_id,'attendance.manage')) or (kind='loot' and public.has_permission(guild_id,'treasury.read')));
revoke all on public.activity_reports,public.activity_evidence from public,anon,authenticated;
grant select on public.activity_reports,public.activity_evidence to authenticated;
create index activity_evidence_event on public.activity_evidence(event_id,kind,created_at,id);
alter table public.treasury_loot add column catalog_id uuid,add column catalog_photo text not null default '' check(length(catalog_photo)<=100000);

create function private.apply_activity_details(p_id uuid,p_payload jsonb,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare e public.events; item jsonb; a record; selected uuid[]; full_ids uuid[]; member_id uuid;
 facts jsonb:=coalesce(p_payload->'facts','{}'); guests jsonb:=coalesce(p_payload->'guests','[]');
 images jsonb:=coalesce(p_payload->'evidence','[]'); old_report public.activity_reports;
 b public.guild_activity_banners; weight integer:=(p_payload->>'weight')::integer; source text:=p_payload->>'source';
begin
 e:=private.lock_managed_event(p_id,'events.manage');
 if e.status='cancelled' then raise exception 'EVENT_CLOSED'; end if;
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
   if exists(select 1 from public.activity_evidence v where v.id=(item#>>'{}')::uuid and ((v.kind='roster' and not public.has_permission(e.guild_id,'attendance.manage')) or(v.kind='loot' and not public.has_permission(e.guild_id,'treasury.manage')))) then raise exception 'FORBIDDEN'; end if;
   delete from public.activity_evidence where id=(item#>>'{}')::uuid and event_id=e.id;
  end loop;
 end if;
 for item in select value from jsonb_array_elements(images) loop
  if item->>'kind' not in ('roster','loot') or item->>'kind' is null then raise exception 'INVALID_EVIDENCE'; end if;
  if not public.has_permission(e.guild_id,case when item->>'kind'='roster' then 'attendance.manage' else 'treasury.manage' end) then raise exception 'FORBIDDEN'; end if;
  insert into public.activity_evidence(id,guild_id,event_id,kind,image) values((item->>'id')::uuid,e.guild_id,e.id,item->>'kind',item->>'image');
 end loop;
 if (select count(*) from public.activity_evidence where event_id=e.id)>8 then raise exception 'TOO_MANY_IMAGES'; end if;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(e.guild_id,private.viewer_id(),'activity.report_saved',e.id,jsonb_build_object('reason',p_reason,'before',to_jsonb(old_report),'difficulty',p_payload->>'difficulty','night',p_payload->'night','coefficient',weight,'previous_event',jsonb_build_object('title',e.title,'kind',e.kind,'weight',e.activity_weight,'source',e.treasury_source,'banner',e.activity_banner_id)));
end $$;
revoke all on function private.apply_activity_details(uuid,jsonb,text) from public,anon,authenticated;

create function public.add_activity_drop(p_event uuid,p_catalog uuid,p_catalog_version integer,p_quantity integer,p_request uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare e public.events;c public.guild_drop_registry;result uuid;existing public.treasury_loot;
begin
 select guild_id into e.guild_id from public.events where id=p_event;
 perform private.lock_treasury(e.guild_id);
 select * into e from public.events where id=p_event for update;
 select * into existing from public.treasury_loot where id=p_request;
 if existing.id is not null then
  if existing.event_id=e.id and existing.catalog_id=p_catalog and existing.quantity_total=p_quantity then return existing.id; end if;
  raise exception 'REQUEST_CONFLICT';
 end if;
 select * into c from public.guild_drop_registry where id=p_catalog and guild_id=e.guild_id for share;
 if c.id is null or c.version is distinct from p_catalog_version then raise exception 'CATALOG_STALE'; end if;
 result:=public.add_treasury_loot(p_request,e.id,c.name,'Дроп активности',p_quantity,c.price_units,'Из реестра дропа');
 update public.treasury_loot set catalog_id=c.id,catalog_photo=c.photo where id=result;
 update public.events set version=version+1 where id=e.id;
 return result;
end $$;
create function public.remove_activity_drop(p_id uuid,p_version integer,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare l public.treasury_loot;
begin
 select * into l from public.treasury_loot where id=p_id;
 perform private.lock_treasury(l.guild_id);
 select * into l from public.treasury_loot where id=p_id for update;
 if l.version is distinct from p_version then raise exception 'STALE_VERSION'; end if;
 if char_length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'REASON_REQUIRED'; end if;
 if exists(select 1 from public.treasury_sales where loot_id=l.id) then raise exception 'LOOT_HAS_HISTORY'; end if;
 delete from public.treasury_loot where id=l.id;
 update public.events set version=version+1 where id=l.event_id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(l.guild_id,private.viewer_id(),'activity.loot_removed',l.id,jsonb_build_object('reason',p_reason,'before',to_jsonb(l)));
end $$;

create function public.record_activity(p_request uuid,p_payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare g uuid;m uuid;e public.events;b public.guild_activity_banners;item jsonb;state text:=p_payload->>'status';starts timestamptz:=(p_payload->>'starts_at')::timestamptz;title text:=btrim(p_payload->>'title');
begin
 select id into g from public.guilds where slug='xd' for update;
 if not public.has_permission(g,'events.manage') then raise exception 'FORBIDDEN'; end if;
 select id into m from public.memberships where guild_id=g and user_id=private.viewer_id() and status='active';
 if p_request is null or state is null or state not in ('scheduled','completed') or starts is null or starts<'2000-01-01'::timestamptz or starts>'2101-01-01'::timestamptz then raise exception 'INVALID_INPUT'; end if;
 select * into e from public.events where id=p_request;
 if e.id is not null then
  if e.guild_id=g and e.organizer_id=m and exists(select 1 from public.activity_reports r where r.event_id=e.id and r.request_hash=md5(p_payload::text)) then return e.id; end if;
  raise exception 'REQUEST_CONFLICT';
 end if;
 if state='completed' and starts>now() then raise exception 'EVENT_IN_FUTURE'; end if;
 if state='scheduled' and starts<=now() then raise exception 'EVENT_IN_PAST'; end if;
 if state='completed' and not public.has_permission(g,'attendance.manage') then raise exception 'FORBIDDEN'; end if;
 if nullif(p_payload->>'banner','') is not null then
  select * into b from public.guild_activity_banners where id=(p_payload->>'banner')::uuid and guild_id=g for share;
  if b.id is null or b.version is distinct from (p_payload->>'banner_version')::integer then raise exception 'CATALOG_STALE'; end if;
 end if;
 insert into public.events(id,guild_id,title,kind,starts_at,description,organizer_id,counts_for_attendance,activity_banner_id,activity_banner_name,activity_banner_photo,activity_weight)
 values(p_request,g,title,p_payload->>'kind',starts,coalesce(p_payload->>'description',''),m,coalesce((p_payload->>'counts')::boolean,true),b.id,coalesce(b.name,title),b.photo,(p_payload->>'weight')::integer);
 if state='completed' then update public.events set status='completed',version=version+1 where id=p_request; end if;
 perform private.apply_activity_details(p_request,p_payload,'Первичная запись активности');
 update public.activity_reports set request_hash=md5(p_payload::text) where event_id=p_request;
 if jsonb_array_length(coalesce(p_payload->'loot','[]'))>75 then raise exception 'INVALID_INPUT'; end if;
 for item in select value from jsonb_array_elements(coalesce(p_payload->'loot','[]')) loop
  perform public.add_activity_drop(p_request,(item->>'id')::uuid,(item->>'version')::integer,(item->>'quantity')::integer,(item->>'request_id')::uuid);
 end loop;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'activity.recorded',p_request,jsonb_build_object('status',state,'title',title));
 return p_request;
end $$;
create function public.save_activity_details(p_event uuid,p_version integer,p_payload jsonb,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare e public.events;
begin
 e:=private.lock_managed_event(p_event,'events.manage');
 if e.version is distinct from p_version then raise exception 'STALE_VERSION'; end if;
 perform private.apply_activity_details(e.id,p_payload,p_reason);
end $$;
create function public.cancel_activity(p_event uuid,p_version integer,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare e public.events;
begin
 e:=private.lock_managed_event(p_event,'events.manage');
 if e.version is distinct from p_version then raise exception 'STALE_VERSION'; end if;
 if char_length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'REASON_REQUIRED'; end if;
 if exists(select 1 from public.treasury_loot where event_id=e.id) then raise exception 'LOOT_HAS_HISTORY'; end if;
 update public.events set status='cancelled',attendance_finalized_at=null,attendance_finalized_by=null,version=version+1 where id=e.id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(e.guild_id,private.viewer_id(),'activity.cancelled',e.id,jsonb_build_object('reason',p_reason,'before_status',e.status));
end $$;
revoke all on function public.record_activity(uuid,jsonb),public.save_activity_details(uuid,integer,jsonb,text),public.cancel_activity(uuid,integer,text),public.add_activity_drop(uuid,uuid,integer,integer,uuid),public.remove_activity_drop(uuid,integer,text) from public,anon;
grant execute on function public.record_activity(uuid,jsonb),public.save_activity_details(uuid,integer,jsonb,text),public.cancel_activity(uuid,integer,text),public.add_activity_drop(uuid,uuid,integer,integer,uuid),public.remove_activity_drop(uuid,integer,text) to authenticated;

create function public.activity_journal(p_from timestamptz,p_until timestamptz,p_filters jsonb default '{}',p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare g uuid;staff boolean;finance boolean;result jsonb;
begin
 select id into g from public.guilds where slug='xd';
 if not private.is_member(g) then raise exception 'FORBIDDEN'; end if;
 staff:=public.has_permission(g,'attendance.manage');finance:=private.finance_staff(g);
 if p_from is null or p_until is null or p_from>=p_until or p_until-p_from>interval '366 days' or p_page not between 1 and 10000 then raise exception 'INVALID_PERIOD'; end if;
 if coalesce(p_filters->>'player','')<>'' and not staff then raise exception 'FORBIDDEN'; end if;
 with base as (
  select e.id,e.title,e.kind,e.starts_at,e.status,e.treasury_source,e.attendance_finalized_at,e.version,e.activity_banner_id,
   coalesce(r.difficulty,'normal') as difficulty,coalesce(r.is_night,false) as is_night,
   e.activity_banner_photo is not null and e.activity_banner_photo<>'' as has_banner,
   case when staff then case when e.status='scheduled' then (select count(*) from public.event_signups s where s.event_id=e.id) else (select count(*) from public.attendance a where a.event_id=e.id and a.mark='present') end end as participants,
   case when staff and e.attendance_finalized_at is not null and e.status='completed' then (select round(100.0*count(*) filter(where a.mark='present')/nullif(count(*) filter(where a.mark in ('present','absent')),0),1) from public.attendance a where a.event_id=e.id) end as percentage,
   case when finance then (select coalesce(sum(w.amount_units),0) from public.treasury_awards w join public.treasury_allocations x on x.id=w.allocation_id and x.voided_at is null join public.treasury_sales s on s.id=x.sale_id and s.voided_at is null join public.treasury_loot l on l.id=s.loot_id where l.event_id=e.id) end as awarded,
   case when finance then (select coalesce(sum((select coalesce(sum(p.amount_units),0) from public.treasury_payouts p where p.award_id=w.id and p.voided_at is null)),0) from public.treasury_awards w join public.treasury_allocations x on x.id=w.allocation_id and x.voided_at is null join public.treasury_sales s on s.id=x.sale_id and s.voided_at is null join public.treasury_loot l on l.id=s.loot_id where l.event_id=e.id) end as paid
  from public.events e left join public.activity_reports r on r.event_id=e.id
  where e.guild_id=g and e.starts_at>=p_from and e.starts_at<p_until
   and (coalesce(p_filters->>'source','')='' or e.treasury_source=p_filters->>'source')
   and (coalesce(p_filters->>'kind','')='' or (case when e.kind='pvp' then 'pvp' else 'pve' end)=p_filters->>'kind')
   and (coalesce(p_filters->>'banner','')='' or e.activity_banner_id=(p_filters->>'banner')::uuid)
   and (coalesce(p_filters->>'player','')='' or exists(select 1 from public.attendance a join public.memberships m on m.id=a.membership_id where a.event_id=e.id and a.mark='present' and strpos(lower(m.nickname),lower(p_filters->>'player'))>0) or exists(select 1 from public.event_signups s join public.memberships m on m.id=s.membership_id where s.event_id=e.id and strpos(lower(m.nickname),lower(p_filters->>'player'))>0))
 ), labelled as (
  select *,case when status='cancelled' then 'cancelled' when status='scheduled' then 'scheduled' when awarded>paid then 'pending_payout' when awarded>0 and paid>=awarded then 'paid' when attendance_finalized_at is null then 'unconfirmed' else 'completed' end as journal_status from base
 ), filtered as (
  select * from labelled where coalesce(p_filters->>'status','')='' or journal_status=p_filters->>'status' or (p_filters->>'status'='all_completed' and status='completed')
 ), paged as (select * from filtered order by starts_at desc,id desc offset (p_page-1)*15 limit 15)
 select jsonb_build_object('total',(select count(*) from filtered),'page',p_page,'can_view_roster',staff,'kpis',jsonb_build_object('total',(select count(*) from filtered),'average',(select round(avg(participants),1) from filtered where status='completed' and attendance_finalized_at is not null),'best',(select max(participants) from filtered where status='completed' and attendance_finalized_at is not null),'cancelled',(select count(*) from filtered where status='cancelled')),'rows',coalesce((select jsonb_agg(to_jsonb(p)-'awarded'-'paid' order by p.starts_at desc,p.id desc) from paged p),'[]')) into result;
 return result;
end $$;

create function private.activity_journal_status(p_event uuid) returns text language plpgsql stable security definer set search_path='' as $$
declare e public.events;awarded numeric;paid numeric;
begin
 select * into e from public.events where id=p_event;
 if e.status in ('scheduled','cancelled') then return e.status; end if;
 if private.finance_staff(e.guild_id) then
  select coalesce(sum(w.amount_units),0),coalesce(sum((select coalesce(sum(p.amount_units),0) from public.treasury_payouts p where p.award_id=w.id and p.voided_at is null)),0) into awarded,paid from public.treasury_awards w join public.treasury_allocations x on x.id=w.allocation_id and x.voided_at is null join public.treasury_sales s on s.id=x.sale_id and s.voided_at is null join public.treasury_loot l on l.id=s.loot_id where l.event_id=e.id;
  if awarded>paid then return 'pending_payout'; end if;
  if awarded>0 then return 'paid'; end if;
 end if;
 return case when e.attendance_finalized_at is null then 'unconfirmed' else 'completed' end;
end $$;
revoke all on function private.activity_journal_status(uuid) from public,anon,authenticated;

create function public.activity_detail(p_event uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e public.events;r public.activity_reports;staff boolean;money boolean;result jsonb;actor uuid:=private.viewer_id();
begin
 select * into e from public.events where id=p_event;
 if e.id is null or not private.is_member(e.guild_id) then raise exception 'FORBIDDEN'; end if;
 staff:=public.has_permission(e.guild_id,'attendance.manage');money:=public.has_permission(e.guild_id,'treasury.read');
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
revoke all on function public.activity_journal(timestamptz,timestamptz,jsonb,integer),public.activity_detail(uuid) from public,anon;
grant execute on function public.activity_journal(timestamptz,timestamptz,jsonb,integer),public.activity_detail(uuid) to authenticated;
create function private.clear_invalid_full_participation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.mark='present' and new.mark is distinct from 'present' then
  update public.activity_reports r set facts=jsonb_set(r.facts,'{full_participation}',coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(r.facts->'full_participation','[]')) x where x#>>'{}'<>new.membership_id::text),'[]')) where r.event_id=new.event_id and (r.facts->'full_participation') ? new.membership_id::text;
 end if;
 return new;
end $$;
revoke all on function private.clear_invalid_full_participation() from public,anon,authenticated;
create trigger xd_activity_fact_invalidation after update of mark on public.attendance for each row execute function private.clear_invalid_full_participation();
notify pgrst,'reload schema';
commit;
