begin;

-- Additive migration: keep the already-published foundation migration unchanged.
alter table public.memberships
 add column about text not null default '' check(char_length(about)<=500),
 add column avatar_style text not null default 'gold' check(avatar_style in ('gold','crimson','teal','silver')),
 add column profile_version integer not null default 1 check(profile_version>0);

create table public.characters (
 id uuid primary key default gen_random_uuid(), guild_id uuid not null, membership_id uuid not null,
 name text not null check(private.valid_nickname(name)),
 name_key text generated always as (private.nickname_key(name)) stored,
 game_server text not null default '' check(char_length(game_server)<=60),
 character_class text not null default '' check(char_length(character_class)<=80),
 specialization text not null default '' check(char_length(specialization)<=120),
 is_main boolean not null default false, archived_at timestamptz,
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(guild_id,membership_id) references public.memberships(guild_id,id),
 check(archived_at is null or not is_main)
);
-- A member may have characters on different servers. Names do not identify accounts.
create unique index xd_character_name on public.characters(membership_id,lower(game_server),name_key) where archived_at is null;
create unique index xd_one_main_character on public.characters(membership_id) where is_main and archived_at is null;
create index xd_characters_member on public.characters(guild_id,membership_id);
create table public.nickname_history (
 id bigint generated always as identity primary key, guild_id uuid not null, membership_id uuid not null,
 old_nickname text not null, new_nickname text not null, changed_by uuid not null references public.profiles(id),
 reason text not null check(char_length(reason) between 3 and 500), changed_at timestamptz not null default now(),
 foreign key(guild_id,membership_id) references public.memberships(guild_id,id)
);
create index xd_nickname_history_member on public.nickname_history(membership_id,id desc);

create function private.can_edit_member(p_member_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships m where m.id=p_member_id and m.status='active'
 and private.is_member(m.guild_id) and (m.user_id=private.viewer_id() or
 (public.has_permission(m.guild_id,'members.manage') and not exists(
 select 1 from public.membership_roles mr join public.roles r on r.id=mr.role_id
 where mr.membership_id=m.id and r.code='owner'))))
$$;
-- All member writes use the same lock order as application review / role / block operations.
create function private.lock_editable_member(p_member_id uuid) returns public.memberships
language plpgsql security definer set search_path='' as $$
declare m public.memberships;
begin
 select * into m from public.memberships where id=p_member_id;
 if m.id is null or not private.can_edit_member(m.id) then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.guilds where id=m.guild_id for update;
 select * into m from public.memberships where id=p_member_id for update;
 if not private.can_edit_member(m.id) then raise exception 'FORBIDDEN'; end if;
 return m;
end $$;

create function public.update_member_profile(p_member_id uuid,p_expected_version integer,p_about text,p_avatar_style text) returns void
language plpgsql security definer set search_path='' as $$
declare m public.memberships; clean text:=btrim(coalesce(p_about,''));
begin
 m:=private.lock_editable_member(p_member_id);
 if char_length(clean)>500 or p_avatar_style is null or p_avatar_style not in ('gold','crimson','teal','silver') then raise exception 'INVALID_PROFILE'; end if;
 if m.about=clean and m.avatar_style=p_avatar_style then return; end if;
 if m.profile_version is distinct from p_expected_version then raise exception 'STALE_VERSION'; end if;
 update public.memberships set about=clean,avatar_style=p_avatar_style,profile_version=profile_version+1 where id=m.id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(m.guild_id,private.viewer_id(),'member.profile_changed',m.id,
 jsonb_build_object('before',jsonb_build_object('about',m.about,'avatar_style',m.avatar_style),'after',jsonb_build_object('about',clean,'avatar_style',p_avatar_style)));
end $$;
create function public.change_member_nickname(p_member_id uuid,p_expected_version integer,p_nickname text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare m public.memberships; clean text:=private.clean_nickname(p_nickname); actor uuid;
begin
 m:=private.lock_editable_member(p_member_id); actor:=private.viewer_id();
 if not private.valid_nickname(clean) then raise exception 'INVALID_NICKNAME'; end if;
 if m.nickname=clean then return; end if;
 if m.profile_version is distinct from p_expected_version then raise exception 'STALE_VERSION'; end if;
 if char_length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'CHANGE_REASON_REQUIRED'; end if;
 if m.user_id=actor and not public.has_permission(m.guild_id,'members.manage') and exists(
  select 1 from public.nickname_history where membership_id=m.id and changed_at>now()-interval '1 minute') then raise exception 'NICKNAME_RATE_LIMIT'; end if;
 if exists(select 1 from public.memberships where guild_id=m.guild_id and id<>m.id and status='active' and nickname_key=private.nickname_key(clean)) then raise exception 'NICKNAME_UNAVAILABLE'; end if;
 update public.memberships set nickname=clean,profile_version=profile_version+1 where id=m.id;
 insert into public.nickname_history(guild_id,membership_id,old_nickname,new_nickname,changed_by,reason)
 values(m.guild_id,m.id,m.nickname,clean,actor,btrim(p_reason));
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail)
 values(m.guild_id,actor,'member.nickname_changed',m.id,jsonb_build_object('before',m.nickname,'after',clean,'reason',btrim(p_reason)));
end $$;

-- p_character_id is generated once per create form, making a double submit safe.
create function public.save_character(p_member_id uuid,p_character_id uuid,p_expected_version integer,
 p_name text,p_game_server text,p_character_class text,p_specialization text,p_is_main boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare m public.memberships; c public.characters; clean text:=private.clean_nickname(p_name);
 srv text:=btrim(regexp_replace(normalize(coalesce(p_game_server,''),NFKC),'[[:space:]]+',' ','g'));
 cls text:=btrim(coalesce(p_character_class,'')); spec text:=btrim(coalesce(p_specialization,'')); make_main boolean; before_state jsonb; previous_main uuid;
begin
 m:=private.lock_editable_member(p_member_id);
 if p_character_id is null or p_is_main is null or not private.valid_nickname(clean)
 or char_length(srv)>60 or char_length(cls)>80 or char_length(spec)>120 then raise exception 'INVALID_CHARACTER'; end if;
 select * into c from public.characters where id=p_character_id for update;
 if c.id is not null and (c.membership_id<>m.id or c.guild_id<>m.guild_id or c.archived_at is not null) then raise exception 'CHARACTER_UNAVAILABLE'; end if;
 if c.id is not null and p_expected_version=0 then
  if c.name=clean and c.game_server=srv and c.character_class=cls and c.specialization=spec and (not p_is_main or c.is_main) then return c.id; end if;
  raise exception 'STALE_VERSION';
 end if;
 if c.id is not null and c.version is distinct from p_expected_version then raise exception 'STALE_VERSION'; end if;
 if c.id is null and p_expected_version is distinct from 0 then raise exception 'CHARACTER_UNAVAILABLE'; end if;
 if c.id is null and (select count(*) from public.characters where membership_id=m.id and archived_at is null)>=20 then raise exception 'CHARACTER_LIMIT'; end if;
 if exists(select 1 from public.characters where membership_id=m.id and id<>p_character_id and archived_at is null
 and lower(game_server)=lower(srv) and name_key=private.nickname_key(clean)) then raise exception 'CHARACTER_NAME_UNAVAILABLE'; end if;
 make_main:=p_is_main or coalesce(c.is_main,false) or not exists(select 1 from public.characters where membership_id=m.id and is_main and archived_at is null);
 before_state:=case when c.id is null then null else to_jsonb(c) end;
 select id into previous_main from public.characters where membership_id=m.id and is_main and archived_at is null;
 if make_main then
  update public.characters set is_main=false,version=version+1,updated_at=now() where membership_id=m.id and id<>p_character_id and is_main;
 end if;
 if c.id is null then
  insert into public.characters(id,guild_id,membership_id,name,game_server,character_class,specialization,is_main)
  values(p_character_id,m.guild_id,m.id,clean,srv,cls,spec,make_main);
 else
  update public.characters set name=clean,game_server=srv,character_class=cls,specialization=spec,is_main=make_main,version=version+1,updated_at=now() where id=c.id;
 end if;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail)
 values(m.guild_id,private.viewer_id(),case when c.id is null then 'character.created' else 'character.updated' end,p_character_id,
 jsonb_build_object('membership_id',m.id,'previous_main_id',previous_main,'before',before_state,'after',(select to_jsonb(ch) from public.characters ch where ch.id=p_character_id)));
 return p_character_id;
end $$;
create function public.archive_character(p_member_id uuid,p_character_id uuid,p_expected_version integer,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare m public.memberships; c public.characters; replacement uuid;
begin
 m:=private.lock_editable_member(p_member_id);
 select * into c from public.characters where id=p_character_id for update;
 if c.id is null or c.membership_id<>m.id or c.guild_id<>m.guild_id then raise exception 'CHARACTER_UNAVAILABLE'; end if;
 if c.archived_at is not null then return; end if;
 if c.version is distinct from p_expected_version then raise exception 'STALE_VERSION'; end if;
 if char_length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'CHANGE_REASON_REQUIRED'; end if;
 update public.characters set archived_at=now(),is_main=false,version=version+1,updated_at=now() where id=c.id;
 if c.is_main then
  select id into replacement from public.characters where membership_id=m.id and archived_at is null order by created_at,id limit 1;
  update public.characters set is_main=true,version=version+1,updated_at=now() where id=replacement;
 end if;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(m.guild_id,private.viewer_id(),'character.archived',c.id,
 jsonb_build_object('membership_id',m.id,'before',to_jsonb(c),'reason',btrim(p_reason),'new_main_id',replacement));
end $$;

alter table public.characters enable row level security;
alter table public.nickname_history enable row level security;
create policy character_read on public.characters for select to authenticated using(
 (archived_at is null and exists(select 1 from public.memberships m where m.id=membership_id and m.status='active' and
 (m.user_id=private.viewer_id() or public.has_permission(m.guild_id,'members.read')))) or private.can_edit_member(membership_id));
create policy nickname_history_read on public.nickname_history for select to authenticated using(
 exists(select 1 from public.memberships m where m.id=membership_id and m.user_id=private.viewer_id()) or public.has_permission(guild_id,'members.manage'));
revoke all on public.characters,public.nickname_history from public,anon,authenticated;
grant select on public.characters,public.nickname_history to authenticated;
revoke all on function private.can_edit_member(uuid),private.lock_editable_member(uuid) from public,anon,authenticated;
grant execute on function private.can_edit_member(uuid) to authenticated;
revoke all on function public.update_member_profile(uuid,integer,text,text),public.change_member_nickname(uuid,integer,text,text),
 public.save_character(uuid,uuid,integer,text,text,text,text,boolean),public.archive_character(uuid,uuid,integer,text) from public,anon;
grant execute on function public.update_member_profile(uuid,integer,text,text),public.change_member_nickname(uuid,integer,text,text),
 public.save_character(uuid,uuid,integer,text,text,text,text,boolean),public.archive_character(uuid,uuid,integer,text) to authenticated;

-- Invoker view: filters and pagination use the same RLS as direct table queries.
create view public.member_directory with (security_invoker=true) as
 select m.id,m.guild_id,m.nickname,m.status,m.joined_at,m.about,m.avatar_style,
  c.name as main_character,c.character_class,c.specialization,c.game_server,
  coalesce((select array_agg(r.code order by r.code) from public.membership_roles mr join public.roles r on r.id=mr.role_id where mr.membership_id=m.id),'{}'::text[]) as role_codes,
  coalesce((select array_agg(r.name order by r.code) from public.membership_roles mr join public.roles r on r.id=mr.role_id where mr.membership_id=m.id),'{}'::text[]) as role_names
 from public.memberships m left join public.characters c on c.membership_id=m.id and c.guild_id=m.guild_id and c.is_main and c.archived_at is null;
revoke all on public.member_directory from public,anon,authenticated;
grant select on public.member_directory to authenticated;
commit;
