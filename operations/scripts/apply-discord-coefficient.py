"""Apply the additive activity workspace schema to the verified live project."""
import os,json,re,subprocess,urllib.parse,urllib.request,urllib.error,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[2]
SSH=['ssh','-i',os.path.expanduser('~/.ssh/xd_operations'),'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=20','root@200.165.236.194']
remote='app=$(systemctl show xd-guild --property=WorkingDirectory --value); cd "$app"; node'
source="require('@next/env').loadEnvConfig(process.cwd());console.log(JSON.stringify({origin:process.env.APP_ORIGIN,url:process.env.NEXT_PUBLIC_SUPABASE_URL}));"
result=subprocess.run(SSH+[remote],input=source,text=True,capture_output=True,timeout=45,check=True)
target=json.loads(result.stdout);assert target['origin']=='https://xd-guild.ru'
url=urllib.parse.urlsplit(target['url']);ref=url.hostname.removesuffix('.supabase.co')
assert url.scheme=='https' and url.hostname.endswith('.supabase.co') and re.fullmatch('[a-z0-9]{20}',ref)
def query(sql):
 req=urllib.request.Request('https://api.supabase.com/v1/projects/'+ref+'/database/query',data=json.dumps({'query':sql}).encode(),headers={'Authorization':'Bearer '+os.environ['SUPABASE_ACCESS_TOKEN'],'Content-Type':'application/json'},method='POST')
 try:
  with urllib.request.urlopen(req,timeout=180) as response:return json.load(response)
 except urllib.error.HTTPError as e:
  print('SUPABASE_SQL_HTTP_ERROR',e.code,flush=True)
  try: print('SQL_DIAGNOSTIC',json.loads(e.read()).get('message','')[:800],flush=True)
  except Exception: pass
  raise SystemExit(1)



migration=(ROOT/'operations/discord-activity-coefficient.sql').read_text()
old=(ROOT/'operations/discord-import.sql').read_text().split('create function public.record_discord_activity',1)[1].split('as $$',1)[1].split('$$;',1)[0]
new=migration.split('as $$',1)[1].split('$$;',1)[0]
def literal(value):return "'"+value.replace("'","''")+"'"
old=re.sub(r'\s+',' ',old).strip();new=re.sub(r'\s+',' ',new).strip()
protected="array['events','attendance','guild_activity_banners','discord_imports','treasury_loot','treasury_sales','treasury_awards','treasury_allocations','treasury_payouts','treasury_expenses','payroll_batches','salary_statements','period_archives','activity_archives','memberships']"
pre="""begin isolation level repeatable read;
set local statement_timeout='120s';
set local lock_timeout='10s';
select pg_advisory_xact_lock(hashtext('xd-discord-coefficient-057'));
create table if not exists private.discord_import_schema_backups(version text primary key,definition text not null,created_at timestamptz not null default now());
revoke all on private.discord_import_schema_backups from public,anon,authenticated;
create temporary table coefficient_migration_guard(name text primary key,digest text) on commit drop;
do $verify$ declare v text;t text;h text;begin
 select prosrc into v from pg_proc where oid='public.record_discord_activity(text,text,text,text,text,uuid,jsonb)'::regprocedure;
 if v is null or btrim(regexp_replace(v,'[[:space:]]+',' ','g')) not in ("""+literal(old)+","+literal(new)+""") then raise exception 'LIVE_IMPORT_FUNCTION_DIFFERS';end if;
 insert into private.discord_import_schema_backups(version,definition) values('057',pg_get_functiondef('public.record_discord_activity(text,text,text,text,text,uuid,jsonb)'::regprocedure)) on conflict do nothing;
 foreach t in array """+protected+""" loop
 execute format($q$select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb)::text) from public.%I x where guild_id='00000000-0000-4000-8000-000000000001'$q$,t) into h;
 insert into coefficient_migration_guard values(t,h);
 end loop;
end $verify$;
"""
post="""do $verify$ declare t text;h text;begin
 foreach t in array """+protected+""" loop
 execute format($q$select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb)::text) from public.%I x where guild_id='00000000-0000-4000-8000-000000000001'$q$,t) into h;
 if h is distinct from(select digest from coefficient_migration_guard where name=t) then raise exception 'EXISTING_DATA_CHANGED: %',t;end if;
 end loop;
 if has_function_privilege('anon','public.record_discord_activity(text,text,text,text,text,uuid,jsonb)','execute') or has_function_privilege('authenticated','public.record_discord_activity(text,text,text,text,text,uuid,jsonb)','execute') or not has_function_privilege('service_role','public.record_discord_activity(text,text,text,text,text,uuid,jsonb)','execute') then raise exception 'RPC_ACL_CHANGED';end if;
end $verify$;
select true as coefficient_schema_ready,true as existing_events_finances_unchanged,true as service_only_rpc_preserved,false as test_activities_created;
commit;"""
assert migration.startswith('begin;')
sql=migration.replace('begin;',pre,1).replace('commit;',post,1)
print('DISCORD_COEFFICIENT_SCHEMA_VERIFIED',json.dumps(query(sql)),flush=True)
