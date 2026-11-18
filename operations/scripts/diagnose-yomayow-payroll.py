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


statements=["with g as(select id from public.guilds where slug='xd'),calc as(select private.lifetime_payroll(id) r from g)\nselect (select count(*) from public.memberships m,g where m.guild_id=g.id and lower(m.nickname)='yomayow') as matching_members,\nr->>'prime_units' as unallocated_prime_units,r->>'mini_units' as unallocated_mini_units,\n(select coalesce(jsonb_agg(v),'[]') from jsonb_array_elements(r->'rows') v where lower(v->>'nickname')='yomayow') as member_payroll from calc", "with m as(select id,guild_id from public.memberships where lower(nickname)='yomayow')\nselect e.activity_archive_id is not null as archived,e.treasury_source,count(*) filter(where a.mark='present') as present,count(*) as marked\nfrom public.attendance a join m on m.id=a.membership_id and m.guild_id=a.guild_id join public.events e on e.id=a.event_id\nwhere e.deleted_at is null and not e.inventory_receipt group by 1,2", "with m as(select id,guild_id from public.memberships where lower(nickname)='yomayow')\nselect s.source,count(distinct s.id) as sales,count(distinct a.id) as allocations,\ncoalesce(sum(w.amount_units) filter(where w.membership_id=m.id),0)::text as member_award_units\nfrom m join public.treasury_sales s on s.guild_id=m.guild_id and s.voided_at is null left join public.treasury_allocations a on a.sale_id=s.id and a.voided_at is null left join public.treasury_awards w on w.allocation_id=a.id group by s.source", "with m as(select id,guild_id from public.memberships where lower(nickname)='yomayow')\nselect b.created_at,b.period_from,b.snapshot->>'scope' as scope,\n(select v-'id'-'nickname' from jsonb_array_elements(b.snapshot->'rows') v where (v->>'id')::uuid=m.id) as member_when_frozen\nfrom public.payroll_batches b join m on m.guild_id=b.guild_id order by b.created_at desc limit 5"]
for label,statement in zip(["CURRENT","ATTENDANCE","ALLOCATIONS","FROZEN"],statements):
 rows=query("begin read only;set local statement_timeout='15s';"+statement+";rollback;")
 print("YOMAYOW_"+label,json.dumps(rows,ensure_ascii=False),flush=True)

rows=query("begin read only;set local statement_timeout='15s';with g as(select id from public.guilds where slug='xd') select src,private.fund_balance(g.id,src)::text as cash_units,private.fund_reserved(g.id,src)::text as reserved_units from g cross join unnest(array['prime','mini_rb']) src;rollback;")
print("YOMAYOW_AVAILABLE_FUNDS",json.dumps(rows),flush=True)
