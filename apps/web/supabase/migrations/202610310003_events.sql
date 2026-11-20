begin;
insert into public.permissions(key) values('events.manage');
insert into public.role_permissions(role_id,permission) select id,'events.manage' from public.roles where code in ('owner','admin','officer');
create table public.events (
 id uuid primary key default gen_random_uuid(), guild_id uuid not null references public.guilds(id),
 title text not null check(char_length(btrim(title)) between 3 and 120),
 kind text not null check(kind in ('raid','pvp','siege','farm','guild')),
 starts_at timestamptz not null, description text not null default '' check(char_length(description)<=4000),
 organizer_id uuid not null, status text not null default 'scheduled' check(status in ('scheduled','completed','cancelled')),
 counts_for_attendance boolean not null default true, created_at timestamptz not null default now(),
 foreign key(guild_id,organizer_id) references public.memberships(guild_id,id),unique(guild_id,id)
);
create table public.event_signups (
 guild_id uuid not null,event_id uuid not null,membership_id uuid not null,created_at timestamptz not null default now(),
 primary key(event_id,membership_id),
 foreign key(guild_id,event_id) references public.events(guild_id,id),
 foreign key(guild_id,membership_id) references public.memberships(guild_id,id)
);
create function public.create_event(p_title text,p_kind text,p_starts_at timestamptz,p_description text,p_counts boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare g uuid;m uuid;result uuid;
begin
 select id into g from public.guilds where slug='xd' for update;
 if not public.has_permission(g,'events.manage') then raise exception 'FORBIDDEN'; end if;
 if p_starts_at<=now() then raise exception 'EVENT_IN_PAST'; end if;
 select id into m from public.memberships where guild_id=g and user_id=private.viewer_id() and status='active';
 insert into public.events(guild_id,title,kind,starts_at,description,organizer_id,counts_for_attendance)
 values(g,btrim(p_title),p_kind,p_starts_at,btrim(p_description),m,p_counts) returning id into result;
 insert into public.audit_log(guild_id,actor_id,action,target_id) values(g,private.viewer_id(),'event.created',result);
 return result;
end $$;
create function public.set_event_signup(p_event_id uuid,p_join boolean) returns void
language plpgsql security definer set search_path='' as $$
declare e public.events;m uuid;
begin
 select * into e from public.events where id=p_event_id for update;
 if e.id is null or not private.is_member(e.guild_id) then raise exception 'FORBIDDEN'; end if;
 if e.status<>'scheduled' or e.starts_at<=now() then raise exception 'EVENT_CLOSED'; end if;
 select id into m from public.memberships where guild_id=e.guild_id and user_id=private.viewer_id() and status='active';
 if p_join is null then raise exception 'INVALID_INPUT'; end if;
 if p_join then insert into public.event_signups(guild_id,event_id,membership_id) values(e.guild_id,e.id,m) on conflict do nothing;
 else delete from public.event_signups where event_id=e.id and membership_id=m; end if;
end $$;
alter table public.events enable row level security;
alter table public.event_signups enable row level security;
create policy events_read on public.events for select to authenticated using(private.is_member(guild_id));
create policy signup_read on public.event_signups for select to authenticated using(private.is_member(guild_id));
revoke all on public.events,public.event_signups from public,anon,authenticated;
grant select on public.events,public.event_signups to authenticated;
revoke all on function public.create_event(text,text,timestamptz,text,boolean),public.set_event_signup(uuid,boolean) from public,anon;
grant execute on function public.create_event(text,text,timestamptz,text,boolean),public.set_event_signup(uuid,boolean) to authenticated;
commit;
