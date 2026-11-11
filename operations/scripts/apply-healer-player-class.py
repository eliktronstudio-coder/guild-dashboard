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

state=query("select position('Хил' in pg_get_functiondef('public.set_own_player_class(text)'::regprocedure))>0 migrated")
if not state[0]['migrated']:
 signature="select md5(coalesce((select jsonb_agg(to_jsonb(m) order by id)::text from public.memberships m),'[]')) memberships,(select count(*) from public.events) events,(select count(*) from public.attendance) attendance,(select count(*) from public.treasury_sales) sales,(select count(*) from public.treasury_payouts) payouts"
 before=query(signature);query((ROOT/'operations/healer-player-class.sql').read_text());assert before==query(signature)
 print('HEALER_CLASS_ADDED_WITH_EXISTING_SELECTIONS_AND_FINANCIAL_RECORDS_PRESERVED',flush=True)
checks=query("select position('Хил' in pg_get_functiondef('public.set_own_player_class(text)'::regprocedure))>0 selection,position('Хил' in pg_get_functiondef('public.complete_open_registration(text,text,boolean,boolean,text)'::regprocedure))>0 enrollment,position('Хил' in pg_get_functiondef('private.capture_email_registration()'::regprocedure))>0 registration,position('Хил' in pg_get_constraintdef((select oid from pg_constraint where conrelid='public.memberships'::regclass and conname='memberships_player_class_check')))>0 membership_constraint,position('Хил' in pg_get_constraintdef((select oid from pg_constraint where conrelid='private.email_registrations'::regclass and conname='email_registrations_player_class_check')))>0 registration_constraint")
assert len(checks)==1 and all(checks[0].values());print('HEALER_CLASS_DATABASE_VALIDATORS_VERIFIED',flush=True)
