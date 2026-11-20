-- Registered alternate characters belong to the existing guild membership. ACL unchanged.
create or replace function public.discord_import_context(p_server text,p_channel text,p_parent text,p_user text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;result jsonb;g uuid:='00000000-0000-4000-8000-000000000001';
begin
 actor:=private.discord_actor(p_server,p_channel,p_parent,p_user);
 select jsonb_build_object('members',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'nickname',m.nickname,'joined_at',m.joined_at,'aliases',(select coalesce(jsonb_agg(distinct c.name),'[]'::jsonb) from public.characters c where c.membership_id=m.id and c.guild_id=m.guild_id and c.archived_at is null))),'[]') from public.memberships m where m.guild_id=g and m.status='active'),
 'activities',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'weight',weight,'version',version) order by name),'[]') from public.guild_activity_banners where guild_id=g),
 'drops',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'version',version,'price_units',price_units::text) order by name),'[]') from public.guild_drop_registry where guild_id=g)) into result;
 perform set_config('xd.discord_actor','',true);return result;
end $$;
