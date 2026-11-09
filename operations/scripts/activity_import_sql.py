import json,re

def statement(entry,guild,import_id):
 assert re.fullmatch('[0-9a-f-]{36}',guild)
 assert re.fullmatch('[a-z0-9-]+',import_id)
 payload=json.dumps(entry,ensure_ascii=False)
 assert '$xd_payload$' not in payload and '$xd_import$' not in payload
 return """begin;
do $xd_import$
declare entry jsonb:=$xd_payload$"""+payload+"""$xd_payload$::jsonb;
 old public.guild_activity_banners; target_guild uuid:='"""+guild+"""';
begin
 select * into old from public.guild_activity_banners where id=(entry->>'id')::uuid for update;
 if exists(select 1 from public.audit_log where guild_id=target_guild and target_id=(entry->>'id')::uuid and detail->>'import_id'='"""+import_id+"""') then
  if old.id is not null and old.guild_id=target_guild and old.name=entry->>'name' and old.photo=entry->>'photo' and old.weight=(entry->>'weight')::integer then return; end if;
  raise exception 'IMPORT_ALREADY_APPLIED_RECORD_CHANGED';
 end if;
 if old.id is null then
  if (entry->>'expected_version')::integer<>0 then raise exception 'IMPORT_STALE_VERSION'; end if;
  insert into public.guild_activity_banners(id,guild_id,name,photo,weight) values((entry->>'id')::uuid,target_guild,entry->>'name',entry->>'photo',(entry->>'weight')::integer);
 else
  if old.guild_id<>target_guild or old.version<>(entry->>'expected_version')::integer then raise exception 'IMPORT_STALE_VERSION'; end if;
  if old.name=entry->>'name' and old.photo=entry->>'photo' and old.weight=(entry->>'weight')::integer then return; end if;
  update public.guild_activity_banners set name=entry->>'name',photo=entry->>'photo',weight=(entry->>'weight')::integer,version=version+1 where id=old.id;
 end if;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(target_guild,null,'activity_banner.saved',(entry->>'id')::uuid,jsonb_build_object('import_id','"""+import_id+"""','actor','authorized_activity_banner_import','name',entry->>'name','weight',entry->>'weight','source',entry->'source','aliases',entry->'aliases','before',case when old.id is null then null else to_jsonb(old) end));
end $xd_import$;
commit;"""
