begin;
-- A configured channel is the authorization boundary for Discord participants.
-- Existing website permissions are neither granted nor changed for those users.
alter table public.discord_settings add column import_membership_id uuid;
alter table public.discord_settings add foreign key(guild_id,import_membership_id) references public.memberships(guild_id,id);
update public.discord_settings s set import_membership_id=coalesce(
 (select m.id from public.audit_log a join public.memberships m on m.user_id=a.actor_id and m.guild_id=a.guild_id join public.profiles p on p.id=m.user_id where a.guild_id=s.guild_id and a.action='discord.settings' and m.status='active' and not p.blocked order by a.id desc limit 1),
 (select m.id from public.memberships m join public.membership_roles mr on mr.membership_id=m.id join public.roles r on r.id=mr.role_id join public.profiles p on p.id=m.user_id where m.guild_id=s.guild_id and m.status='active' and not p.blocked and r.code='owner' order by m.joined_at limit 1)
);
create or replace function public.save_discord_settings(p_server text,p_channel text,p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$
declare g uuid:='00000000-0000-4000-8000-000000000001';member_id uuid;
begin
 if not public.has_permission(g,'discord.manage') then raise exception 'FORBIDDEN'; end if;
 if not public.has_permission(g,'events.manage') or not public.has_permission(g,'attendance.manage') or not public.has_permission(g,'treasury.manage') then raise exception 'FORBIDDEN'; end if;
 select id into member_id from public.memberships where guild_id=g and user_id=private.viewer_id() and status='active';
 insert into public.discord_settings(guild_id,discord_guild_id,channel_id,enabled,import_membership_id) values(g,p_server,p_channel,p_enabled,member_id)
 on conflict(guild_id) do update set discord_guild_id=excluded.discord_guild_id,channel_id=excluded.channel_id,enabled=excluded.enabled,import_membership_id=excluded.import_membership_id,connected_at=null,updated_at=now();
 insert into public.audit_log(guild_id,actor_id,action,detail) values(g,private.viewer_id(),'discord.settings',jsonb_build_object('server',p_server,'channel',p_channel,'enabled',p_enabled,'access','all_channel_members'));
end $$;
create or replace function private.discord_actor(p_server text,p_channel text,p_parent text,p_user text) returns uuid language plpgsql security definer set search_path='' as $$
declare g uuid:='00000000-0000-4000-8000-000000000001';actor uuid;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'FORBIDDEN'; end if;
 if coalesce(p_user,'') !~ '^[0-9]{17,22}$' then raise exception 'FORBIDDEN'; end if;
 if not exists(select 1 from public.discord_settings where guild_id=g and enabled and discord_guild_id=p_server and (channel_id=p_channel or channel_id=p_parent)) then raise exception 'DISCORD_CHANNEL_FORBIDDEN'; end if;
 select m.user_id into actor from public.discord_settings s join public.memberships m on m.id=s.import_membership_id and m.guild_id=s.guild_id join public.profiles p on p.id=m.user_id where s.guild_id=g and m.status='active' and not p.blocked;
 if actor is null then raise exception 'DISCORD_CONNECTION_OWNER_UNAVAILABLE'; end if;
 perform set_config('xd.discord_actor',actor::text,true);
 if not public.has_permission(g,'events.manage') or not public.has_permission(g,'attendance.manage') or not public.has_permission(g,'treasury.manage') then raise exception 'DISCORD_CONNECTION_OWNER_UNAVAILABLE'; end if;
 return actor;
end $$;
-- Retire staff-binding mutations: they no longer control channel import access.
revoke execute on function public.save_discord_staff(text,uuid,boolean) from authenticated;
notify pgrst,'reload schema';
commit;
