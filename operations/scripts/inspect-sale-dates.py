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


rows=query("""select s.id,s.created_at,s.accounting_period,s.source,s.quantity,s.gross_units::text,s.fund_units::text,s.guild_units::text,s.voided_at is not null as voided,l.name,l.category,l.catalog_id,l.archived_period,
 (select count(*)::int from public.treasury_allocations a where a.sale_id=s.id and a.voided_at is null) allocations,
 (select coalesce(sum(p.amount_units),0)::text from public.treasury_allocations a join public.treasury_awards w on w.allocation_id=a.id join public.treasury_payouts p on p.award_id=w.id where a.sale_id=s.id and a.voided_at is null and p.voided_at is null) paid
from public.treasury_sales s join public.treasury_loot l on l.id=s.loot_id where s.guild_id=(select id from public.guilds where slug='xd') order by s.created_at,s.id""")
print('SALE_DATE_PREFLIGHT',json.dumps(rows,ensure_ascii=False),flush=True)
print('PERIOD_ARCHIVES',json.dumps(query("select period_from,closed_at from public.period_archives where guild_id=(select id from public.guilds where slug='xd') order by period_from")),flush=True)
