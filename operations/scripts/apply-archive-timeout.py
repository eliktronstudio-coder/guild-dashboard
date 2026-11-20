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
  with urllib.request.urlopen(req,timeout=90) as response:return json.load(response)
 except urllib.error.HTTPError as e:
  print('SUPABASE_SQL_HTTP_ERROR',e.code,flush=True)
  raise SystemExit(1)


result=query("begin isolation level repeatable read;\nset local statement_timeout='60s';set local lock_timeout='2s';\ncreate temporary table archive_timeout_guard(name text primary key,digest text) on commit drop;\ndo $guard$ declare t text;h text;begin\n if not has_function_privilege('authenticated','public.archive_activities(uuid,date,date)','execute') or has_function_privilege('anon','public.archive_activities(uuid,date,date)','execute') then raise exception 'ARCHIVE_ACL_UNEXPECTED';end if;\n insert into archive_timeout_guard select 'function',md5(prosrc||coalesce(proacl::text,'')) from pg_proc where oid='public.archive_activities(uuid,date,date)'::regprocedure;\n foreach t in array array['events','attendance','activity_archives','treasury_loot','treasury_sales','treasury_awards','treasury_allocations','treasury_payouts','treasury_expenses','salary_statements','period_archives','memberships'] loop\n execute format('select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]''::jsonb)::text) from public.%I x',t) into h;\n insert into archive_timeout_guard values(t,h);\n end loop;\nend $guard$;\nalter function public.archive_activities(uuid,date,date) set statement_timeout='30s';\nalter function public.archive_activities(uuid,date,date) set lock_timeout='2s';\ndo $guard$ declare t text;h text;begin\n if (select md5(prosrc||coalesce(proacl::text,'')) from pg_proc where oid='public.archive_activities(uuid,date,date)'::regprocedure) is distinct from (select digest from archive_timeout_guard where name='function') then raise exception 'ARCHIVE_BODY_OR_ACL_CHANGED';end if;\n foreach t in array array['events','attendance','activity_archives','treasury_loot','treasury_sales','treasury_awards','treasury_allocations','treasury_payouts','treasury_expenses','salary_statements','period_archives','memberships'] loop\n execute format('select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]''::jsonb)::text) from public.%I x',t) into h;\n if h is distinct from(select digest from archive_timeout_guard where name=t) then raise exception 'EXISTING_DATA_CHANGED';end if;\n end loop;\nend $guard$;\nnotify pgrst,'reload schema';\nselect true as archive_timeout_30_seconds,true as lock_wait_2_seconds,true as existing_data_unchanged;\ncommit;")
print("ARCHIVE_TIMEOUT_SETTINGS_APPLIED",json.dumps(result),flush=True)
checks=query("select proconfig from pg_proc where oid='public.archive_activities(uuid,date,date)'::regprocedure")
assert all(x in checks[0]['proconfig'] for x in ['statement_timeout=30s','lock_timeout=2s'])
print("ARCHIVE_TIMEOUT_SETTINGS_VERIFIED",flush=True)
