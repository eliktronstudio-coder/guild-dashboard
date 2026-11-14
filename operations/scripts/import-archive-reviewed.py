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
  print('SUPABASE_SQL_HTTP_ERROR',e.code,flush=True);raise SystemExit(1)


manifest=json.loads(subprocess.run(SSH+['node'],input=(ROOT/'operations/build-archive-payloads.cjs').read_text(),text=True,capture_output=True,check=True,timeout=60).stdout)
assert manifest['authorised_no_paid_api'] is True
records=manifest['records'];print('REVIEWED_ARCHIVE_RECORDS',len(records),flush=True)
GUARD="""create temp table archive_financial_guard(name text,digest text) on commit drop;
do $$declare t text;h text;begin foreach t in array array['treasury_sales','treasury_allocations','treasury_awards','treasury_payouts','treasury_expenses','payroll_batches','payroll_requests','period_archives'] loop
if to_regclass('public.'||t) is null then continue;end if;
execute format('select md5(coalesce(string_agg(md5(row_to_json(r)::text), %L order by md5(row_to_json(r)::text)),%L)) from public.%I r','','',t) into h;insert into archive_financial_guard values(t,h);end loop;end $$;"""
VERIFY="""do $$declare r record;h text;begin for r in select * from archive_financial_guard loop
execute format('select md5(coalesce(string_agg(md5(row_to_json(x)::text), %L order by md5(row_to_json(x)::text)),%L)) from public.%I x','','',r.name) into h;
if h<>r.digest then raise exception 'ARCHIVE_IMPORT_CHANGED_FINANCIAL_RECORDS';end if;end loop;end $$;"""
def quoted(s):return "'"+str(s).replace("'","''")+"'"
def transaction(r,dry=False):
 body=json.dumps(r['payload'],ensure_ascii=False,separators=(',',':'));assert '$archive_payload$' not in body
 return "begin isolation level repeatable read;\n"+GUARD+"\nselect set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);\nselect set_config('xd.discord_actor',(select m.user_id::text from public.discord_settings s join public.memberships m on m.id=s.import_membership_id and m.guild_id=s.guild_id where s.guild_id=(select id from public.guilds where slug='xd')),true);\nselect public.record_activity("+quoted(r['id'])+"::uuid,$archive_payload$"+body+"$archive_payload$::jsonb);\n"+VERIFY+('\nrollback;' if dry else '\ncommit;')
# Validate the complete application write and evidence processing, then roll back.
if records:
 first=next((r for r in records if not query('select 1 as found from public.events where id='+quoted(r['id'])+'::uuid')),None)
 if first:
  query(transaction(first,True));assert not query('select 1 as found from public.events where id='+quoted(first['id'])+'::uuid')
  print('ARCHIVE_IMPORT_DRY_RUN_PASSED_AND_ROLLED_BACK',flush=True)
result=[]
for i,r in enumerate(records):
 p=r['payload'];existing=query("select e.id from public.events e where e.deleted_at is null and (e.id="+quoted(r['id'])+"::uuid or (e.starts_at="+quoted(p['starts_at'])+"::timestamptz and lower(e.title)=lower("+quoted(p['title'])+")) or position("+quoted(r['source'])+" in coalesce(e.description,''))>0) union select event_id id from public.discord_imports where message_id="+quoted(r['source']))
 if existing:
  result.append({'source':r['source'],'event_id':existing[0]['id'],'state':'existing_preserved'});continue
 query(transaction(r))
 check=query('select e.id,(select count(*) from public.attendance a where a.event_id=e.id and a.mark=\'present\')::int participants,(select count(*) from public.activity_evidence v where v.event_id=e.id)::int images,(select count(*) from public.treasury_loot l where l.event_id=e.id)::int loot_rows from public.events e where e.id='+quoted(r['id'])+'::uuid')
 assert len(check)==1 and check[0]['participants']==len(set(p['members'])) and check[0]['images']==len(p['evidence']) and check[0]['loot_rows']==len(p['loot'])
 result.append({'source':r['source'],'event_id':r['id'],'state':'created','participants':check[0]['participants'],'images':check[0]['images']})
 print('ARCHIVE_IMPORT_PROGRESS',i+1,'/',len(records),flush=True)
(ROOT/'archive-import-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print('ARCHIVE_IMPORT_RESULT',json.dumps({'created':sum(x['state']=='created' for x in result),'existing_preserved':sum(x['state']=='existing_preserved' for x in result),'total':len(result)}),flush=True)
print('ARCHIVE_CREATED_EVENT_IDS',','.join(x['event_id'] for x in result if x['state']=='created'),flush=True)
