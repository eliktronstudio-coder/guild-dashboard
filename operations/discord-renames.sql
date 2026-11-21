begin;
create table if not exists private.discord_renames (
 guild_id uuid not null references public.guilds(id), message_id text not null,
 discord_user text not null, membership_id uuid not null references public.memberships(id),
 old_nickname text not null,new_nickname text not null,created_at timestamptz not null default now(),
 primary key(guild_id,message_id)
);
revoke all on private.discord_renames from public,anon,authenticated;
create or replace function public.rename_discord_member(p_server text,p_channel text,p_parent text,p_user text,p_message text,p_old text,p_new text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g uuid:='00000000-0000-4000-8000-000000000001';s public.discord_settings;m public.memberships;prior private.discord_renames;clean text:=private.clean_nickname(p_new);old_clean text:=private.clean_nickname(p_old);matches integer;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'FORBIDDEN';end if;
 if p_channel is distinct from '1211335490024771674' or p_parent is not null then raise exception 'DISCORD_CHANNEL_FORBIDDEN';end if;
 if coalesce(p_message,'') !~ '^[0-9]{17,22}$' or not private.valid_nickname(clean) or not private.valid_nickname(old_clean) or clean=old_clean then raise exception 'INVALID_RENAME';end if;
 select * into s from public.discord_settings where guild_id=g and enabled and discord_guild_id=p_server;
 if s.guild_id is null then raise exception 'DISCORD_CHANNEL_FORBIDDEN';end if;
 perform private.discord_actor(p_server,s.channel_id,null,p_user);
 if not public.has_permission(g,'members.manage') then raise exception 'FORBIDDEN';end if;
 perform 1 from public.guilds where id=g for update;
 select * into prior from private.discord_renames where guild_id=g and message_id=p_message;
 if found then
  if prior.discord_user<>p_user or prior.old_nickname<>old_clean or prior.new_nickname<>clean then raise exception 'REQUEST_CONFLICT';end if;
  perform set_config('xd.discord_actor','',true);
  return jsonb_build_object('membership_id',prior.membership_id,'nickname',prior.new_nickname,'replayed',true);
 end if;
 select count(*) into matches from public.memberships where guild_id=g and status='active' and nickname_key=private.nickname_key(old_clean);
 if matches=0 then
  select count(distinct a.id) into matches from public.memberships a join public.nickname_history h on h.membership_id=a.id and h.guild_id=a.guild_id where a.guild_id=g and a.status='active' and private.nickname_key(h.old_nickname)=private.nickname_key(old_clean);
  if matches=1 then select a.* into m from public.memberships a where a.guild_id=g and a.status='active' and exists(select 1 from public.nickname_history h where h.membership_id=a.id and h.guild_id=g and private.nickname_key(h.old_nickname)=private.nickname_key(old_clean));end if;
 else
  select * into m from public.memberships where guild_id=g and status='active' and nickname_key=private.nickname_key(old_clean);
 end if;
 if matches<>1 then raise exception 'MEMBER_NOT_UNIQUE';end if;
 perform public.change_member_nickname(m.id,m.profile_version,clean,'Discord rename: '||p_message||' / '||p_user);
 insert into private.discord_renames(guild_id,message_id,discord_user,membership_id,old_nickname,new_nickname) values(g,p_message,p_user,m.id,old_clean,clean);
 perform set_config('xd.discord_actor','',true);
 return jsonb_build_object('membership_id',m.id,'nickname',clean,'replayed',false);
end $$;
revoke all on function public.rename_discord_member(text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.rename_discord_member(text,text,text,text,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
