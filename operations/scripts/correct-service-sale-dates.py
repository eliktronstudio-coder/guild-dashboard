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

from sale_date_sql import correction_sql
import hashlib,datetime
plan=json.loads((ROOT/'operations/service-sale-date-plan.json').read_text())
operation=plan['operation']
prior=query("select detail from public.audit_log where action='treasury.sales_backdated_batch' and target_id='"+operation+"'::uuid")
if not prior:
 rows=query("""select s.id,s.created_at,s.accounting_period,s.source,s.quantity,s.gross_units::text,s.fund_units::text,s.guild_units::text,false as voided,l.catalog_id
 from public.treasury_sales s join public.treasury_loot l on l.id=s.loot_id where s.guild_id=(select id from public.guilds where slug='xd') and s.voided_at is null and l.catalog_id is null and l.category='Продажа ХД' and l.name in ('Продажа РБ опыта','Продажа мусора') and s.created_at<='"""+plan['cutoff']+"'::timestamptz order by s.id")
 canonical=[]
 for r in rows:
  x={k:r[k] for k in ['id','created_at','accounting_period','source','quantity','gross_units','fund_units','guild_units','catalog_id']}
  x['created_at']=datetime.datetime.fromisoformat(x['created_at']).astimezone(datetime.timezone.utc).isoformat(timespec='microseconds');canonical.append(x)
 fingerprint=hashlib.sha256(json.dumps(canonical,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 assert len(rows)==plan['count'] and fingerprint==plan['fingerprint'],'Reviewed sale state changed; no correction applied'
 query(correction_sql(rows,operation))
 print('SALE_DATES_CORRECTED_WITH_FINANCE_STOCK_AND_HISTORY_PRESERVED',flush=True)
else:print('SALE_DATE_CORRECTION_ALREADY_APPLIED',flush=True)
verified=query("""select count(*)::int count, bool_and(s.accounting_period='2026-10-15' and (s.created_at at time zone 'Asia/Yekaterinburg')::date='2026-11-11' and (s.created_at at time zone 'UTC')::date='2026-11-11' and (to_jsonb(s)-'created_at'-'accounting_period')=((a.detail->'before')-'created_at'-'accounting_period')) valid,
 sum(s.gross_units)::text gross_units,coalesce(sum(s.fund_units) filter(where s.source='prime'),0)::text prime_units,coalesce(sum(s.fund_units) filter(where s.source='mini_rb'),0)::text mini_units,sum(s.guild_units)::text guild_units
 from public.audit_log a join public.treasury_sales s on s.id=a.target_id where a.action='treasury.sale_date_corrected' and a.detail->>'operation'='"""+operation+"'")
assert len(verified)==1 and verified[0]['count']==plan['count'] and verified[0]['valid']
assert query("select tgenabled='O' as guarded from pg_trigger where tgrelid='public.treasury_sales'::regclass and tgname='sale_period'")[0]['guarded']
print('BACKDATED_SALES_VERIFIED',json.dumps(verified[0]),flush=True)
print('PERIOD_SALES_TOTALS',json.dumps(query("select accounting_period,source,count(*)::int count,sum(gross_units)::text gross_units from public.treasury_sales where guild_id=(select id from public.guilds where slug='xd') and voided_at is null group by accounting_period,source order by accounting_period,source")),flush=True)
