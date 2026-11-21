begin;
-- Keep the catalogue identity/version checks, but save an explicit event weight.
create or replace function public.record_discord_activity(p_server text,p_channel text,p_parent text,p_user text,p_message text,p_request uuid,p_payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
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
 if (p_payload->>'weight') is null or (p_payload->>'weight')::integer not between 1 and 100000 then raise exception 'INVALID_INPUT';end if;
 select * into b from public.guild_activity_banners where id=(p_payload->>'banner')::uuid and guild_id=g;
 if b.id is null or b.version is distinct from (p_payload->>'banner_version')::integer or b.name is distinct from p_payload->>'title' then raise exception 'CATALOG_STALE'; end if;
 result:=public.record_activity(p_request,p_payload);
 insert into public.discord_imports(guild_id,event_id,discord_guild_id,channel_id,message_id,discord_user_id,request_hash) values(g,result,p_server,p_channel,p_message,p_user,md5(p_payload::text));
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,actor,'discord.activity_imported',result,jsonb_build_object('server',p_server,'channel',p_channel,'message',p_message,'discord_user',p_user,'activity_weight',(p_payload->>'weight')::integer,'base_weight',b.weight));
 perform set_config('xd.discord_actor','',true);return result;
end $$;
revoke all on function public.record_discord_activity(text,text,text,text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_discord_activity(text,text,text,text,text,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
