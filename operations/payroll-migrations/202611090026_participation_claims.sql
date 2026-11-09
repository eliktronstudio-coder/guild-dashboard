begin;
alter table public.events add column deleted_at timestamptz;
create function public.delete_activity(p_event uuid,p_version integer,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare e public.events;
begin
 e:=private.lock_managed_event(p_event,'events.manage');
 if e.deleted_at is not null then return; end if;
 perform public.cancel_activity(p_event,p_version,p_reason);
 update public.events set deleted_at=now() where id=p_event;
 update public.participation_claims set status='rejected',reviewed_at=now(),reviewed_by=private.viewer_id() where event_id=p_event and status='pending';
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(e.guild_id,private.viewer_id(),'activity.deleted',e.id,jsonb_build_object('reason',p_reason));
end $$;
revoke all on function public.delete_activity(uuid,integer,text) from public,anon;
grant execute on function public.delete_activity(uuid,integer,text) to authenticated;
create table public.participation_claims (
 id uuid primary key, guild_id uuid not null, event_id uuid not null, membership_id uuid not null,
 screenshot text not null check(length(screenshot) between 40 and 500000 and screenshot ~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+$'),
 status text not null default 'pending' check(status in ('pending','accepted','rejected')),
 created_at timestamptz not null default now(), reviewed_at timestamptz, reviewed_by uuid references public.profiles(id),
 unique(event_id,membership_id),
 foreign key(guild_id,event_id) references public.events(guild_id,id),
 foreign key(guild_id,membership_id) references public.memberships(guild_id,id)
);
alter table public.participation_claims enable row level security;
create policy claims_read on public.participation_claims for select to authenticated using(public.has_permission(guild_id,'attendance.manage') or (private.is_member(guild_id) and exists(select 1 from public.memberships m where m.id=membership_id and m.user_id=private.viewer_id())));
revoke all on public.participation_claims from public,anon,authenticated;
grant select on public.participation_claims to authenticated;
create index participation_claims_inbox on public.participation_claims(guild_id,status,created_at);
create function public.submit_participation_claim(p_id uuid,p_event uuid,p_screenshot text) returns uuid language plpgsql security definer set search_path='' as $$
declare e public.events; m public.memberships; c public.participation_claims;
begin
 select * into e from public.events where id=p_event;
 if not private.is_member(e.guild_id) then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.guilds where id=e.guild_id for update;
 select * into e from public.events where id=p_event;
 select * into m from public.memberships where guild_id=e.guild_id and user_id=private.viewer_id() and status='active';
 if e.status<>'completed' or e.starts_at>now() or e.deleted_at is not null or not e.counts_for_attendance then raise exception 'EVENT_NOT_COMPLETED'; end if;
 if p_id is null or p_screenshot is null or length(p_screenshot) not between 40 and 500000 or p_screenshot !~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+$' then raise exception 'INVALID_IMAGE'; end if;
 select * into c from public.participation_claims where event_id=p_event and membership_id=m.id;
 if c.id is not null then return c.id; end if;
 if exists(select 1 from public.attendance where event_id=p_event and membership_id=m.id and mark='present') then raise exception 'ALREADY_PRESENT'; end if;
 if (select count(*) from public.participation_claims where membership_id=m.id and created_at>now()-interval '1 day')>=10 then raise exception 'RATE_LIMITED'; end if;
 insert into public.participation_claims(id,guild_id,event_id,membership_id,screenshot) values(p_id,e.guild_id,p_event,m.id,p_screenshot);
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(e.guild_id,private.viewer_id(),'participation.claimed',p_id,jsonb_build_object('event_id',p_event,'membership_id',m.id));
 return p_id;
end $$;
create function public.review_participation_claim(p_id uuid,p_accept boolean) returns void language plpgsql security definer set search_path='' as $$
declare c public.participation_claims; e public.events; a public.attendance; finalized boolean;
begin
 select * into c from public.participation_claims where id=p_id;
 if c.id is null or p_accept is null then raise exception 'INVALID_CLAIM'; end if;
 e:=private.lock_managed_event(c.event_id,'attendance.manage');
 select * into c from public.participation_claims where id=p_id for update;
 if c.status<>'pending' then
  if c.status=(case when p_accept then 'accepted' else 'rejected' end) then return; end if;
  raise exception 'ALREADY_REVIEWED';
 end if;
 if e.status<>'completed' or e.deleted_at is not null then raise exception 'EVENT_NOT_COMPLETED'; end if;
 if p_accept then
  if not exists(select 1 from public.memberships where id=c.membership_id and status='active') then raise exception 'FORBIDDEN'; end if;
  finalized:=e.attendance_finalized_at is not null;
  insert into public.attendance(guild_id,event_id,membership_id,mark) values(c.guild_id,c.event_id,c.membership_id,'absent') on conflict do nothing;
  select * into a from public.attendance where event_id=c.event_id and membership_id=c.membership_id;
  perform public.mark_attendance(c.event_id,c.membership_id,a.version,'present','Одобрена заявка участника со скриншотом');
  if finalized then
   select * into e from public.events where id=c.event_id;
   perform public.finalize_attendance(e.id,e.version);
  end if;
 end if;
 update public.participation_claims set status=case when p_accept then 'accepted' else 'rejected' end,reviewed_at=now(),reviewed_by=private.viewer_id() where id=c.id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(c.guild_id,private.viewer_id(),'participation.reviewed',c.id,jsonb_build_object('accepted',p_accept,'membership_id',c.membership_id,'event_id',c.event_id));
end $$;
revoke all on function public.submit_participation_claim(uuid,uuid,text),public.review_participation_claim(uuid,boolean) from public,anon;
grant execute on function public.submit_participation_claim(uuid,uuid,text),public.review_participation_claim(uuid,boolean) to authenticated;
create or replace function public.activity_journal(p_from timestamptz,p_until timestamptz,p_filters jsonb default '{}',p_page integer default 1) returns jsonb
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
  where e.guild_id=g and e.deleted_at is null and e.starts_at>=p_from and e.starts_at<p_until
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


commit;
