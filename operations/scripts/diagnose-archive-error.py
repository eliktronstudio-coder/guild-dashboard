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
  try: print('SQL_DIAGNOSTIC',json.loads(e.read()).get('message','')[:800],flush=True)
  except Exception: pass
  raise SystemExit(1)



# Never export production log text. Request only fixed categories and counts.
categories={'STATEMENT_TIMEOUT':'statement timeout','DEADLOCK':'deadlock','ARCHIVE_GUARD':'ACTIVITY_ARCHIVED','PERIOD_GUARD':'PERIOD_CLOSED','AMBIGUOUS_COLUMN':'column reference','FOREIGN_KEY':'foreign key constraint','UNIQUE_CONSTRAINT':'unique constraint','CHECK_CONSTRAINT':'check constraint','PERMISSION_DENIED':'permission denied','MISSING_COLUMN':'does not exist','RECORD_FIELD':'has no field'}
cases=' '.join("when regexp_contains(event_message, '"+pattern+"') then '"+name+"'" for name,pattern in categories.items())
logsql="select case "+cases+" else 'OTHER' end as category,count(*) as occurrences from postgres_logs where regexp_contains(event_message, 'statement timeout|deadlock|ACTIVITY_ARCHIVED|PERIOD_CLOSED|column reference|constraint|permission denied|does not exist|has no field') group by category"
req=urllib.request.Request('https://api.supabase.com/v1/projects/'+ref+'/analytics/endpoints/logs.all?'+urllib.parse.urlencode({'sql':logsql}),headers={'Authorization':'Bearer '+os.environ['SUPABASE_ACCESS_TOKEN']})
try:
 with urllib.request.urlopen(req,timeout=40) as response:logs=json.load(response)
 rows=logs.get('result',[]) if isinstance(logs,dict) else []
 safe=[{'category':r['category'],'occurrences':int(r['occurrences'])} for r in rows if isinstance(r,dict) and r.get('category') in categories and str(r.get('occurrences','')).isdigit()]
 print('DATABASE_ERROR_CATEGORIES_ONLY',json.dumps(safe),flush=True)
except urllib.error.HTTPError as e:print('LOG_CATEGORY_QUERY_UNAVAILABLE',e.code,flush=True)
