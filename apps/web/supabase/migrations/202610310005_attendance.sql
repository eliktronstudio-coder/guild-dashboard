begin;
insert into public.permissions values('attendance.manage');
insert into public.role_permissions select id,'attendance.manage' from public.roles where code in ('owner','admin','officer');
alter table public.events add column attendance_finalized_at timestamptz, add column attendance_finalized_by uuid references public.profiles(id);
create table public.attendance (
 guild_id uuid not null,event_id uuid not null,membership_id uuid not null,
 mark text check(mark in ('present','absent','excused','excluded')),
 version integer not null default 1 check(version>0), updated_at timestamptz not null default now(),
 primary key(event_id,membership_id),
 foreign key(guild_id,event_id) references public.events(guild_id,id),
 foreign key(guild_id,membership_id) references public.memberships(guild_id,id)
);
create table public.attendance_revisions (
 id bigint generated always as identity primary key, guild_id uuid not null,event_id uuid not null,membership_id uuid not null,
 old_mark text,new_mark text not null, actor_id uuid not null references public.profiles(id),
 reason text not null check(char_length(reason) between 3 and 500),created_at timestamptz not null default now(),
 foreign key(event_id,membership_id) references public.attendance(event_id,membership_id),
 foreign key(guild_id,event_id) references public.events(guild_id,id)
);
create function private.lock_managed_event(p_id uuid,p_permission text) returns public.events
language plpgsql security definer set search_path='' as $$
declare e public.events;g uuid;
begin
 select guild_id into g from public.events where id=p_id;
 if g is null or not public.has_permission(g,p_permission) then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.guilds where id=g for update;
 select * into e from public.events where id=p_id for update;
 if not public.has_permission(g,p_permission) then raise exception 'FORBIDDEN'; end if;
 return e;
end $$;
revoke all on function private.lock_managed_event(uuid,text) from public,anon,authenticated;

-- Signup is not applicability. Completion produces a candidate roster for officer verification.
create function private.snapshot_event_roster() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='completed' and old.status<>'completed' then
  insert into public.attendance(guild_id,event_id,membership_id)
  select new.guild_id,new.id,m.id from public.memberships m where m.guild_id=new.guild_id and m.joined_at<=new.starts_at
  on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function private.snapshot_event_roster() from public,anon,authenticated;
create trigger xd_event_roster after update of status on public.events for each row execute function private.snapshot_event_roster();
-- If completed events existed before this migration they also require a first review.
insert into public.attendance(guild_id,event_id,membership_id)
select e.guild_id,e.id,m.id from public.events e join public.memberships m on m.guild_id=e.guild_id and m.joined_at<=e.starts_at where e.status='completed';

create function public.mark_attendance(p_event_id uuid,p_membership_id uuid,p_version integer,p_mark text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare e public.events;a public.attendance;
begin
 e:=private.lock_managed_event(p_event_id,'attendance.manage');
 if e.status<>'completed' or e.starts_at>now() then raise exception 'EVENT_NOT_COMPLETED'; end if;
 select * into a from public.attendance where event_id=e.id and membership_id=p_membership_id for update;
 if a.event_id is null then raise exception 'NOT_IN_ROSTER'; end if;
 if p_mark is null or p_mark not in ('present','absent','excused','excluded') then raise exception 'INVALID_MARK'; end if;
 if a.mark=p_mark then return; end if;
 if a.version is distinct from p_version then raise exception 'STALE_VERSION'; end if;
 if char_length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'REASON_REQUIRED'; end if;
 update public.attendance set mark=p_mark,version=version+1,updated_at=now() where event_id=e.id and membership_id=p_membership_id;
 insert into public.attendance_revisions(guild_id,event_id,membership_id,old_mark,new_mark,actor_id,reason)
 values(e.guild_id,e.id,p_membership_id,a.mark,p_mark,private.viewer_id(),btrim(p_reason));
 -- A correction invalidates the whole report until the officer confirms it again.
 update public.events set attendance_finalized_at=null,attendance_finalized_by=null,version=version+1 where id=e.id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(e.guild_id,private.viewer_id(),'attendance.changed',e.id,
 jsonb_build_object('membership_id',p_membership_id,'before',a.mark,'after',p_mark,'reason',btrim(p_reason)));
end $$;
create function public.finalize_attendance(p_event_id uuid,p_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare e public.events;
begin
 e:=private.lock_managed_event(p_event_id,'attendance.manage');
 if e.status<>'completed' or e.starts_at>now() then raise exception 'EVENT_NOT_COMPLETED'; end if;
 if e.attendance_finalized_at is not null then return; end if;
 if e.version is distinct from p_version then raise exception 'STALE_VERSION'; end if;
 if not exists(select 1 from public.attendance where event_id=e.id) then raise exception 'EMPTY_ROSTER'; end if;
 if exists(select 1 from public.attendance where event_id=e.id and mark is null) then raise exception 'UNMARKED_MEMBERS'; end if;
 update public.events set attendance_finalized_at=now(),attendance_finalized_by=private.viewer_id(),version=version+1 where id=e.id;
 insert into public.audit_log(guild_id,actor_id,action,target_id) values(e.guild_id,private.viewer_id(),'attendance.finalized',e.id);
end $$;

create function public.edit_event(p_id uuid,p_version integer,p_title text,p_kind text,p_starts_at timestamptz,p_description text,p_counts boolean,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare e public.events;
begin
 e:=private.lock_managed_event(p_id,'events.manage');
 if e.status<>'scheduled' then raise exception 'EVENT_CLOSED'; end if;
 if e.version is distinct from p_version then raise exception 'STALE_VERSION'; end if;
 if p_starts_at is null or (p_starts_at<>e.starts_at and (e.starts_at<=now() or p_starts_at<=now())) then raise exception 'INVALID_EVENT_TIME'; end if;
 if char_length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'REASON_REQUIRED'; end if;
 update public.events set title=btrim(p_title),kind=p_kind,starts_at=p_starts_at,description=btrim(p_description),counts_for_attendance=p_counts,version=version+1 where id=e.id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(e.guild_id,private.viewer_id(),'event.edited',e.id,
 jsonb_build_object('before',to_jsonb(e),'after',(select to_jsonb(x) from public.events x where id=e.id),'reason',btrim(p_reason)));
end $$;

-- Explicit request UUID prevents a double click / network retry from creating two events.
create function public.create_guild_event(p_request_id uuid,p_title text,p_kind text,p_starts_at timestamptz,p_description text,p_counts boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare g uuid;m uuid;e public.events;
begin
 select id into g from public.guilds where slug='xd' for update;
 if not public.has_permission(g,'events.manage') then raise exception 'FORBIDDEN'; end if;
 select id into m from public.memberships where guild_id=g and user_id=private.viewer_id() and status='active';
 if p_request_id is null then raise exception 'INVALID_INPUT'; end if;
 select * into e from public.events where id=p_request_id;
 if e.id is not null then
  if e.guild_id=g and e.organizer_id=m and e.title=btrim(p_title) and e.kind=p_kind and e.starts_at=p_starts_at and e.description=btrim(p_description) and e.counts_for_attendance=p_counts then return e.id; end if;
  raise exception 'REQUEST_CONFLICT';
 end if;
 if p_starts_at is null or p_starts_at<=now() then raise exception 'EVENT_IN_PAST'; end if;
 insert into public.events(id,guild_id,title,kind,starts_at,description,organizer_id,counts_for_attendance)
 values(p_request_id,g,btrim(p_title),p_kind,p_starts_at,btrim(p_description),m,p_counts);
 insert into public.audit_log(guild_id,actor_id,action,target_id) values(g,private.viewer_id(),'event.created',p_request_id);
 return p_request_id;
end $$;

alter table public.attendance enable row level security;
alter table public.attendance_revisions enable row level security;
create policy attendance_read on public.attendance for select to authenticated using(
 public.has_permission(guild_id,'attendance.manage') or (private.is_member(guild_id) and exists(select 1 from public.memberships m where m.id=membership_id and m.user_id=private.viewer_id())));
create policy revision_read on public.attendance_revisions for select to authenticated using(
 public.has_permission(guild_id,'attendance.manage') or (private.is_member(guild_id) and exists(select 1 from public.memberships m where m.id=membership_id and m.user_id=private.viewer_id())));
revoke all on public.attendance,public.attendance_revisions from public,anon,authenticated;
grant select on public.attendance,public.attendance_revisions to authenticated;
revoke all on function public.mark_attendance(uuid,uuid,integer,text,text),public.finalize_attendance(uuid,integer),public.edit_event(uuid,integer,text,text,timestamptz,text,boolean,text),public.create_guild_event(uuid,text,text,timestamptz,text,boolean) from public,anon;
grant execute on function public.mark_attendance(uuid,uuid,integer,text,text),public.finalize_attendance(uuid,integer),public.edit_event(uuid,integer,text,text,timestamptz,text,boolean,text),public.create_guild_event(uuid,text,text,timestamptz,text,boolean) to authenticated;
-- Retire the prototype entry point; application creates events with a request UUID.
revoke execute on function public.create_event(text,text,timestamptz,text,boolean) from authenticated;
create index events_calendar on public.events(guild_id,starts_at,id);
create index attendance_member on public.attendance(membership_id,event_id);
create index attendance_revision_event on public.attendance_revisions(event_id,id desc);

-- Inclusive start, exclusive end; exact integer counts, rounded display percentage.
create function public.attendance_report(p_from timestamptz,p_until timestamptz)
returns table(membership_id uuid,nickname text,present bigint,absent bigint,excused bigint,excluded bigint,percentage numeric)
language plpgsql stable security definer set search_path='' as $$
declare g uuid;actor uuid:=private.viewer_id();
begin
 select id into g from public.guilds where slug='xd';
 if actor is null or not private.is_member(g) then raise exception 'FORBIDDEN'; end if;
 if p_from is null or p_until is null or p_from>=p_until or p_until-p_from>interval '366 days' then raise exception 'INVALID_PERIOD'; end if;
 return query
 select m.id,m.nickname,count(*) filter(where a.mark='present'),count(*) filter(where a.mark='absent'),
 count(*) filter(where a.mark='excused'),count(*) filter(where a.mark='excluded'),
 round(100.0*(count(*) filter(where a.mark='present'))/nullif(count(*) filter(where a.mark in ('present','absent')),0),1)
 from public.memberships m left join (public.attendance a join public.events e on e.id=a.event_id and e.guild_id=a.guild_id
 and e.status='completed' and e.counts_for_attendance and e.attendance_finalized_at is not null
 and e.starts_at<=now() and e.starts_at>=p_from and e.starts_at<p_until) on a.membership_id=m.id and a.guild_id=m.guild_id
 where m.guild_id=g and (m.user_id=actor or public.has_permission(g,'attendance.manage'))
 group by m.id,m.nickname order by m.nickname,m.id;
end $$;
revoke all on function public.attendance_report(timestamptz,timestamptz) from public,anon;
grant execute on function public.attendance_report(timestamptz,timestamptz) to authenticated;
commit;
