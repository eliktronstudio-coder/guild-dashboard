begin;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.guilds (
 id uuid primary key default gen_random_uuid(), slug text unique not null,
 name text not null, description text not null default ''
);
insert into public.guilds (id,slug,name,description) values
 ('00000000-0000-4000-8000-000000000001','xd','XD','Гильдия ArcheAge');
create table public.profiles (
 id uuid primary key references auth.users(id) on delete restrict,
 blocked boolean not null default false, created_at timestamptz not null default now()
);
create function private.new_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.profiles(id) values(new.id) on conflict do nothing; return new; end $$;
create trigger xd_new_profile after insert on auth.users for each row execute function private.new_profile();
insert into public.profiles(id) select id from auth.users on conflict do nothing;

create table public.revoked_sessions (
 session_id uuid primary key, user_id uuid not null references public.profiles(id),
 revoked_at timestamptz not null default now()
);
-- auth.sessions is deliberately checked: a valid but revoked JWT cannot retain access.
create function private.session_user_id() returns uuid language sql stable security definer set search_path='' as $$
 select u.id from auth.users u join auth.sessions s on s.user_id=u.id
 where u.id=auth.uid() and s.id::text=auth.jwt()->>'session_id'
 and (u.email_confirmed_at is not null or exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='custom:telegram'))
 and not exists(select 1 from public.revoked_sessions r where r.session_id=s.id)
$$;
create function private.viewer_id() returns uuid language sql stable security definer set search_path='' as $$
 select p.id from public.profiles p where p.id=private.session_user_id() and not p.blocked
$$;

create function private.clean_nickname(raw text) returns text language sql immutable set search_path='' as $$
 select btrim(regexp_replace(normalize(raw,NFKC), '[[:space:]]+', ' ', 'g'))
$$;
create function private.nickname_key(raw text) returns text language sql immutable set search_path='' as $$
 select translate(lower(private.clean_nickname(raw)), 'авекмнорстухё', 'abekmhopctyxе')
$$;
create function private.valid_nickname(raw text) returns boolean language sql immutable set search_path='' as $$
 select raw is not null and char_length(raw) between 2 and 32 and raw=private.clean_nickname(raw)
 and raw ~ '^[A-Za-zА-Яа-яЁё0-9 _-]+$' and raw ~ '[A-Za-zА-Яа-яЁё]'
 and not (raw ~ '[A-Za-z]' and raw ~ '[А-Яа-яЁё]')
$$;
create table public.memberships (
 id uuid primary key default gen_random_uuid(), guild_id uuid not null references public.guilds(id),
 user_id uuid not null references public.profiles(id), nickname text not null check(private.valid_nickname(nickname)),
 nickname_key text generated always as (private.nickname_key(nickname)) stored,
 status text not null default 'active' check(status in ('active','left')),
 joined_at timestamptz not null default now(), unique(guild_id,user_id), unique(guild_id,id)
);
create unique index xd_active_nickname on public.memberships(guild_id,nickname_key) where status='active';
create table public.roles (
 id uuid primary key default gen_random_uuid(), guild_id uuid not null references public.guilds(id),
 code text not null, name text not null, unique(guild_id,code), unique(guild_id,id)
);
create table public.permissions (key text primary key);
insert into public.permissions values ('members.read'),('members.manage'),('applications.review'),('roles.assign'),('audit.read');
insert into public.roles(guild_id,code,name) select g.id,v.code,v.name from public.guilds g cross join (values
 ('owner','Главный администратор'),('admin','Администратор'),('officer','Офицер'),
 ('treasurer','Казначей'),('member','Участник'),('guest','Гость')) v(code,name);
create table public.role_permissions (
 role_id uuid not null references public.roles(id), permission text not null references public.permissions(key), primary key(role_id,permission)
);
insert into public.role_permissions select r.id,p.key from public.roles r cross join public.permissions p
 where r.code='owner' or (r.code='admin' and p.key<>'roles.assign')
 or (r.code='officer' and p.key in ('members.read','applications.review'))
 or (r.code in ('member','treasurer') and p.key='members.read');
create table public.membership_roles (
 guild_id uuid not null, membership_id uuid not null, role_id uuid not null,
 primary key(membership_id,role_id),
 foreign key(guild_id,membership_id) references public.memberships(guild_id,id),
 foreign key(guild_id,role_id) references public.roles(guild_id,id)
);
create function private.is_member(guild uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships m where m.guild_id=guild and m.user_id=private.viewer_id() and m.status='active')
$$;
create function public.has_permission(guild uuid, permission text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships m join public.membership_roles mr on mr.membership_id=m.id
 join public.role_permissions rp on rp.role_id=mr.role_id
 where m.guild_id=guild and m.user_id=private.viewer_id() and m.status='active' and rp.permission=$2)
$$;
create table public.applications (
 id uuid primary key default gen_random_uuid(), guild_id uuid not null references public.guilds(id),
 user_id uuid not null references public.profiles(id), nickname text not null check(private.valid_nickname(nickname)),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 rules_version text not null, privacy_version text not null, consent_at timestamptz not null default now(),
 created_at timestamptz not null default now(), reviewed_at timestamptz, reviewed_by uuid references public.profiles(id),
 reason text check(char_length(reason)<=500),
 check((status='pending' and reviewed_at is null and reviewed_by is null) or (status<>'pending' and reviewed_at is not null and reviewed_by is not null))
);
create unique index xd_pending_application on public.applications(guild_id,user_id) where status='pending';
create table public.audit_log (
 id bigint generated always as identity primary key, guild_id uuid not null references public.guilds(id),
 actor_id uuid references public.profiles(id), action text not null, target_id uuid, detail jsonb not null default '{}',
 created_at timestamptz not null default now()
);

create function public.submit_application(nickname text, rules_accepted boolean, privacy_accepted boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.viewer_id(); guild uuid; clean text:=private.clean_nickname(nickname); existing uuid; result uuid;
begin
 if actor is null then raise exception 'AUTH_REQUIRED'; end if;
 if rules_accepted is distinct from true or privacy_accepted is distinct from true then raise exception 'CONSENT_REQUIRED'; end if;
 if not private.valid_nickname(clean) then raise exception 'INVALID_NICKNAME'; end if;
 select id into guild from public.guilds where slug='xd' for update;
 if exists(select 1 from public.memberships m where m.guild_id=guild and m.user_id=actor and m.status='active') then raise exception 'ALREADY_MEMBER'; end if;
 select id into existing from public.applications a where a.guild_id=guild and a.user_id=actor and a.status='pending';
 if existing is not null then return existing; end if;
 if exists(select 1 from public.applications a where a.user_id=actor and a.guild_id=guild and a.created_at>now()-interval '1 minute') then raise exception 'TRY_LATER'; end if;
 if exists(select 1 from public.memberships m where m.guild_id=guild and m.status='active' and m.nickname_key=private.nickname_key(clean)) then raise exception 'NICKNAME_UNAVAILABLE'; end if;
 insert into public.applications(guild_id,user_id,nickname,rules_version,privacy_version)
 values(guild,actor,clean,'2026-10-31','2026-10-31') returning id into result;
 insert into public.audit_log(guild_id,actor_id,action,target_id) values(guild,actor,'application.submitted',result);
 return result;
end $$;

create function public.review_application(application_id uuid, decision text, reason text default '') returns void
language plpgsql security definer set search_path='' as $$
declare a public.applications; actor uuid:=private.viewer_id(); member uuid; guild uuid;
begin
 select guild_id into guild from public.applications where id=application_id;
 if guild is null or not public.has_permission(guild,'applications.review') then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.guilds where id=guild for update;
 if not public.has_permission(guild,'applications.review') then raise exception 'FORBIDDEN'; end if;
 select * into a from public.applications where id=application_id for update;
 if actor=a.user_id then raise exception 'SELF_REVIEW_FORBIDDEN'; end if;
 if decision not in ('approved','rejected') or decision is null then raise exception 'INVALID_DECISION'; end if;
 if a.status=decision then return; end if;
 if a.status<>'pending' then raise exception 'ALREADY_REVIEWED'; end if;
 if char_length(reason)>500 or (decision='rejected' and char_length(btrim(coalesce(reason,'')))<3) then raise exception 'REASON_REQUIRED'; end if;
 if decision='approved' then
  if exists(select 1 from public.profiles where id=a.user_id and blocked) then raise exception 'ACCOUNT_BLOCKED'; end if;
  if exists(select 1 from public.memberships m where m.guild_id=a.guild_id and m.status='active' and m.nickname_key=private.nickname_key(a.nickname)) then raise exception 'NICKNAME_UNAVAILABLE'; end if;
  insert into public.memberships(guild_id,user_id,nickname) values(a.guild_id,a.user_id,a.nickname)
  on conflict(guild_id,user_id) do update set nickname=excluded.nickname,status='active',joined_at=now() returning id into member;
  insert into public.membership_roles(guild_id,membership_id,role_id)
  select a.guild_id,member,id from public.roles where guild_id=a.guild_id and code='member' on conflict do nothing;
 end if;
 update public.applications set status=decision,reviewed_by=actor,reviewed_at=now(),reason=btrim($3) where id=a.id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail)
 values(a.guild_id,actor,'application.'||decision,a.id,jsonb_build_object('nickname',a.nickname,'reason',reason));
end $$;

create function public.set_member_blocked(member_id uuid, blocked boolean) returns void
language plpgsql security definer set search_path='' as $$
declare m public.memberships; actor uuid:=private.viewer_id();
begin
 select * into m from public.memberships where id=member_id;
 if m.id is null or not public.has_permission(m.guild_id,'members.manage') then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.guilds where id=m.guild_id for update;
 if not public.has_permission(m.guild_id,'members.manage') then raise exception 'FORBIDDEN'; end if;
 if m.user_id=actor or exists(select 1 from public.membership_roles mr join public.roles r on r.id=mr.role_id where mr.membership_id=m.id and r.code='owner') then raise exception 'OWNER_PROTECTED'; end if;
 if blocked is null then raise exception 'INVALID_INPUT'; end if;
 update public.profiles set blocked=$2 where id=m.user_id;
 insert into public.revoked_sessions(session_id,user_id) select id,user_id from auth.sessions where user_id=m.user_id and $2 on conflict do nothing;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(m.guild_id,actor,'member.block_changed',m.id,jsonb_build_object('blocked',$2));
end $$;
create function public.assign_member_role(member_id uuid, role_code text) returns void
language plpgsql security definer set search_path='' as $$
declare m public.memberships; target_role uuid;
begin
 select * into m from public.memberships where id=member_id;
 if m.id is null or not public.has_permission(m.guild_id,'roles.assign') then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.guilds where id=m.guild_id for update;
 if not public.has_permission(m.guild_id,'roles.assign') then raise exception 'FORBIDDEN'; end if;
 if role_code='owner' or exists(select 1 from public.membership_roles mr join public.roles r on r.id=mr.role_id where mr.membership_id=m.id and r.code='owner') then raise exception 'OWNER_PROTECTED'; end if;
 select id into target_role from public.roles where guild_id=m.guild_id and code=role_code;
 if target_role is null then raise exception 'INVALID_ROLE'; end if;
 delete from public.membership_roles where membership_id=m.id;
 insert into public.membership_roles values(m.guild_id,m.id,target_role);
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(m.guild_id,private.viewer_id(),'member.role_changed',m.id,jsonb_build_object('role',role_code));
end $$;
create function public.revoke_my_sessions(all_sessions boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.session_user_id();
begin
 if actor is null then raise exception 'AUTH_REQUIRED'; end if;
 insert into public.revoked_sessions(session_id,user_id) select id,user_id from auth.sessions
 where user_id=actor and (all_sessions or id::text=auth.jwt()->>'session_id') on conflict do nothing;
end $$;

-- Closed bootstrap: executable only by the database owner, never by anon/authenticated.
create function private.bootstrap_owner(user_id uuid, nickname text) returns void language plpgsql security definer set search_path='' as $$
declare guild uuid; member uuid;
begin
 select id into guild from public.guilds where slug='xd' for update;
 if exists(select 1 from public.membership_roles mr join public.roles r on r.id=mr.role_id where r.guild_id=guild and r.code='owner') then raise exception 'OWNER_ALREADY_EXISTS'; end if;
 if not exists(select 1 from auth.users u where u.id=$1 and (u.email_confirmed_at is not null or exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='custom:telegram'))) then raise exception 'VERIFIED_USER_REQUIRED'; end if;
 insert into public.memberships(guild_id,user_id,nickname) values(guild,$1,private.clean_nickname($2)) returning id into member;
 insert into public.membership_roles select guild,member,id from public.roles where guild_id=guild and code='owner';
 insert into public.audit_log(guild_id,actor_id,action,target_id) values(guild,$1,'owner.bootstrapped',member);
end $$;

-- Only narrow RPCs write. SELECT still obeys row-level policies.
alter table public.guilds enable row level security;
alter table public.profiles enable row level security;
alter table public.revoked_sessions enable row level security;
alter table public.memberships enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.membership_roles enable row level security;
alter table public.applications enable row level security;
alter table public.audit_log enable row level security;
create policy guild_read on public.guilds for select to authenticated using(private.viewer_id() is not null);
create policy profile_read on public.profiles for select to authenticated using(id=private.session_user_id() or exists(select 1 from public.memberships m where m.user_id=profiles.id and public.has_permission(m.guild_id,'members.manage')));
create policy member_read on public.memberships for select to authenticated using(user_id=private.viewer_id() or public.has_permission(guild_id,'members.read'));
create policy roles_read on public.roles for select to authenticated using(private.is_member(guild_id));
create policy mr_read on public.membership_roles for select to authenticated using(private.is_member(guild_id));
create policy rp_read on public.role_permissions for select to authenticated using(exists(select 1 from public.roles r where r.id=role_id and private.is_member(r.guild_id)));
create policy permissions_read on public.permissions for select to authenticated using(private.viewer_id() is not null);
create policy applications_read on public.applications for select to authenticated using(user_id=private.viewer_id() or public.has_permission(guild_id,'applications.review'));
create policy audit_read on public.audit_log for select to authenticated using(public.has_permission(guild_id,'audit.read'));
revoke all on public.guilds, public.profiles, public.revoked_sessions, public.memberships, public.roles, public.permissions, public.role_permissions, public.membership_roles, public.applications, public.audit_log from anon,authenticated;
grant select on public.guilds, public.profiles, public.memberships, public.roles, public.permissions, public.role_permissions, public.membership_roles, public.applications, public.audit_log to authenticated;
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.session_user_id(),private.viewer_id(),private.is_member(uuid) to authenticated;
revoke all on function public.has_permission(uuid,text),public.submit_application(text,boolean,boolean),public.review_application(uuid,text,text),public.set_member_blocked(uuid,boolean),public.assign_member_role(uuid,text),public.revoke_my_sessions(boolean) from public,anon;
grant execute on function public.has_permission(uuid,text),public.submit_application(text,boolean,boolean),public.review_application(uuid,text,text),public.set_member_blocked(uuid,boolean),public.assign_member_role(uuid,text),public.revoke_my_sessions(boolean) to authenticated;
commit;
