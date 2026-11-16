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


checks=query("with g as (select id from public.guilds where slug='xd'), c as (select c.* from g cross join lateral private.attendance_event_counts(g.id,'-infinity'::timestamptz,'infinity'::timestamptz) c), e as (select count(*) n from public.events,g where guild_id=g.id and status='completed' and deleted_at is null and counts_for_attendance and not inventory_receipt and starts_at<=now()) select coalesce(max(total_count),0) as lifetime_events,count(*) filter(where present_count>0) as members_with_attendance,coalesce(bool_and(total_count=(select n from e) and present_count<=total_count and prime_total_count+mini_total_count=total_count),true) as exact_counts from c")
assert checks[0]['exact_counts'] and checks[0]['lifetime_events']>0 and checks[0]['members_with_attendance']>0
print('LIVE_LIFETIME_ATTENDANCE_VERIFIED',json.dumps(checks[0]),flush=True)
