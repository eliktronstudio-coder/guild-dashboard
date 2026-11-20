begin;
insert into public.permissions values('discord.manage');
insert into public.role_permissions select id,'discord.manage' from public.roles where code in ('owner','admin');
create table public.discord_settings (
 guild_id uuid primary key references public.guilds(id),discord_guild_id text not null check(discord_guild_id ~ '^[0-9]{17,22}$'),
 channel_id text not null check(channel_id ~ '^[0-9]{17,22}$'), enabled boolean not null default false,
 connected_at timestamptz,application_id text,updated_at timestamptz not null default now()
);
create table public.discord_staff (
 guild_id uuid not null,discord_user_id text not null check(discord_user_id ~ '^[0-9]{17,22}$'),membership_id uuid not null,
 primary key(guild_id,discord_user_id),foreign key(guild_id,membership_id) references public.memberships(guild_id,id)
);
create table private.discord_credentials(guild_id uuid primary key references public.guilds(id),encrypted_token text not null check(length(encrypted_token) between 40 and 1500));
create table public.discord_imports (
 guild_id uuid not null,event_id uuid not null,discord_guild_id text not null,channel_id text not null,message_id text not null check(message_id ~ '^[0-9]{17,22}$'),
 discord_user_id text not null,request_hash text not null,created_at timestamptz not null default now(),
 primary key(discord_guild_id,channel_id,message_id),foreign key(guild_id,event_id) references public.events(guild_id,id)
);
alter table public.discord_settings enable row level security;
alter table public.discord_staff enable row level security;
alter table public.discord_imports enable row level security;
create policy discord_settings_read on public.discord_settings for select to authenticated using(public.has_permission(guild_id,'discord.manage'));
create policy discord_staff_read on public.discord_staff for select to authenticated using(public.has_permission(guild_id,'discord.manage'));
create policy discord_imports_read on public.discord_imports for select to authenticated using(public.has_permission(guild_id,'discord.manage'));
revoke all on public.discord_settings,public.discord_staff,public.discord_imports,private.discord_credentials from public,anon,authenticated;
grant select on public.discord_settings,public.discord_staff,public.discord_imports to authenticated;
create function public.save_discord_settings(p_server text,p_channel text,p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$
declare g uuid:='00000000-0000-4000-8000-000000000001';
begin
 if not public.has_permission(g,'discord.manage') then raise exception 'FORBIDDEN'; end if;
 insert into public.discord_settings(guild_id,discord_guild_id,channel_id,enabled) values(g,p_server,p_channel,p_enabled)
 on conflict(guild_id) do update set discord_guild_id=excluded.discord_guild_id,channel_id=excluded.channel_id,enabled=excluded.enabled,connected_at=null,updated_at=now();
 insert into public.audit_log(guild_id,actor_id,action,detail) values(g,private.viewer_id(),'discord.settings',jsonb_build_object('server',p_server,'channel',p_channel,'enabled',p_enabled));
end $$;
create function public.save_discord_staff(p_user text,p_member uuid,p_remove boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare g uuid:='00000000-0000-4000-8000-000000000001';
begin
 if not public.has_permission(g,'discord.manage') then raise exception 'FORBIDDEN'; end if;
 if p_remove then delete from public.discord_staff where guild_id=g and discord_user_id=p_user;
 else
  if not exists(select 1 from public.memberships m join public.profiles p on p.id=m.user_id where m.id=p_member and m.guild_id=g and m.status='active' and not p.blocked) then raise exception 'FORBIDDEN'; end if;
  insert into public.discord_staff(guild_id,discord_user_id,membership_id) values(g,p_user,p_member) on conflict(guild_id,discord_user_id) do update set membership_id=excluded.membership_id;
 end if;
 insert into public.audit_log(guild_id,actor_id,action,detail) values(g,private.viewer_id(),'discord.staff',jsonb_build_object('discord_user',p_user,'member',p_member,'removed',p_remove));
end $$;
revoke all on function public.save_discord_settings(text,text,boolean),public.save_discord_staff(text,uuid,boolean) from public,anon;
grant execute on function public.save_discord_settings(text,text,boolean),public.save_discord_staff(text,uuid,boolean) to authenticated;
create function public.set_discord_credential(p_encrypted text,p_actor uuid) returns void language plpgsql security definer set search_path='' as $$
declare g uuid:='00000000-0000-4000-8000-000000000001';
begin
 if not exists(select 1 from public.memberships m join public.profiles p on p.id=m.user_id join public.membership_roles mr on mr.membership_id=m.id join public.role_permissions rp on rp.role_id=mr.role_id where m.user_id=p_actor and m.guild_id=g and m.status='active' and not p.blocked and rp.permission='discord.manage') then raise exception 'FORBIDDEN'; end if;
 insert into private.discord_credentials values(g,p_encrypted) on conflict(guild_id) do update set encrypted_token=excluded.encrypted_token;
 update public.discord_settings set connected_at=null,updated_at=now() where guild_id=g;
 insert into public.audit_log(guild_id,actor_id,action) values(g,p_actor,'discord.token_updated');
end $$;
create function public.discord_runtime(p_application text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare g uuid:='00000000-0000-4000-8000-000000000001'; result jsonb;
begin
 if p_application is not null then
  if p_application !~ '^[0-9]{17,22}$' then raise exception 'INVALID_INPUT'; end if;
  update public.discord_settings set connected_at=now(),application_id=p_application where guild_id=g and enabled;
 end if;
 select jsonb_build_object('enabled',s.enabled,'server',s.discord_guild_id,'channel',s.channel_id,'encrypted_token',c.encrypted_token) into result from public.discord_settings s left join private.discord_credentials c using(guild_id) where s.guild_id=g;
 return result;
end $$;
revoke all on function public.set_discord_credential(text,uuid),public.discord_runtime(text) from public,anon,authenticated;
grant execute on function public.set_discord_credential(text,uuid),public.discord_runtime(text) to service_role;

-- Service delegation is transaction-local, only accepted for a real service_role JWT.
-- All existing event/attendance/treasury RPC permission and audit checks still execute.
create or replace function private.viewer_id() returns uuid language sql stable security definer set search_path='' as $$
 select p.id from public.profiles p where p.id=case
 when auth.jwt()->>'role'='service_role' and nullif(current_setting('xd.discord_actor',true),'') is not null then nullif(current_setting('xd.discord_actor',true),'')::uuid
 else private.session_user_id() end and not p.blocked
$$;
create function private.discord_actor(p_server text,p_channel text,p_parent text,p_user text) returns uuid language plpgsql security definer set search_path='' as $$
declare g uuid:='00000000-0000-4000-8000-000000000001';actor uuid;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'FORBIDDEN'; end if;
 if not exists(select 1 from public.discord_settings where guild_id=g and enabled and discord_guild_id=p_server and (channel_id=p_channel or channel_id=p_parent)) then raise exception 'DISCORD_CHANNEL_FORBIDDEN'; end if;
 select m.user_id into actor from public.discord_staff d join public.memberships m on m.id=d.membership_id join public.profiles p on p.id=m.user_id where d.guild_id=g and d.discord_user_id=p_user and m.status='active' and not p.blocked;
 if actor is null then raise exception 'DISCORD_STAFF_REQUIRED'; end if;
 perform set_config('xd.discord_actor',actor::text,true);
 if not public.has_permission(g,'events.manage') or not public.has_permission(g,'attendance.manage') or not public.has_permission(g,'treasury.manage') then raise exception 'DISCORD_STAFF_REQUIRED'; end if;
 return actor;
end $$;
revoke all on function private.discord_actor(text,text,text,text) from public,anon,authenticated;
create function public.discord_import_context(p_server text,p_channel text,p_parent text,p_user text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;result jsonb;g uuid:='00000000-0000-4000-8000-000000000001';
begin
 actor:=private.discord_actor(p_server,p_channel,p_parent,p_user);
 select jsonb_build_object('members',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'nickname',nickname,'joined_at',joined_at)),'[]') from public.memberships where guild_id=g and status='active'),
 'activities',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'weight',weight,'version',version) order by name),'[]') from public.guild_activity_banners where guild_id=g),
 'drops',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'version',version,'price_units',price_units::text) order by name),'[]') from public.guild_drop_registry where guild_id=g)) into result;
 perform set_config('xd.discord_actor','',true);return result;
end $$;
create function public.record_discord_activity(p_server text,p_channel text,p_parent text,p_user text,p_message text,p_request uuid,p_payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid;existing public.discord_imports;result uuid;g uuid:='00000000-0000-4000-8000-000000000001';b public.guild_activity_banners;
begin
 actor:=private.discord_actor(p_server,p_channel,p_parent,p_user);
 perform 1 from public.guilds where id=g for update;
 if p_message !~ '^[0-9]{17,22}$' or p_payload->>'status' is distinct from 'completed' or p_payload->>'source' not in ('prime','mini_rb') or p_payload->>'kind' not in ('raid','pvp') then raise exception 'INVALID_INPUT'; end if;
 if p_payload->>'confirm_roster' is distinct from 'true' or p_payload->>'counts' is distinct from 'true' or jsonb_typeof(p_payload->'members') is distinct from 'array' or jsonb_array_length(p_payload->'members')<1 then raise exception 'ROSTER_CONFIRMATION_REQUIRED'; end if;
 select * into existing from public.discord_imports where discord_guild_id=p_server and channel_id=p_channel and message_id=p_message;
 if existing.event_id is not null then
  if existing.request_hash<>md5(p_payload::text) then raise exception 'REQUEST_CONFLICT'; end if;
  perform set_config('xd.discord_actor','',true); return existing.event_id;
 end if;
 select * into b from public.guild_activity_banners where id=(p_payload->>'banner')::uuid and guild_id=g;
 if b.id is null or b.version is distinct from (p_payload->>'banner_version')::integer or b.weight is distinct from (p_payload->>'weight')::integer or b.name is distinct from p_payload->>'title' then raise exception 'CATALOG_STALE'; end if;
 result:=public.record_activity(p_request,p_payload);
 insert into public.discord_imports(guild_id,event_id,discord_guild_id,channel_id,message_id,discord_user_id,request_hash) values(g,result,p_server,p_channel,p_message,p_user,md5(p_payload::text));
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,actor,'discord.activity_imported',result,jsonb_build_object('server',p_server,'channel',p_channel,'message',p_message,'discord_user',p_user));
 perform set_config('xd.discord_actor','',true);return result;
end $$;
revoke all on function public.discord_import_context(text,text,text,text),public.record_discord_activity(text,text,text,text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.discord_import_context(text,text,text,text),public.record_discord_activity(text,text,text,text,text,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
