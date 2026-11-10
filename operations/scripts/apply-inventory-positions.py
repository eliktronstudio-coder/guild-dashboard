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

state=query("select to_regprocedure('public.transfer_inventory_to_xd(uuid,uuid,integer,integer)') is not null as migrated")
if not state[0]['migrated']:
 before=query("select (select count(*) from public.treasury_sales) sales,(select count(*) from public.treasury_payouts) payouts,(select sum(quantity_remaining) from public.treasury_loot) physical,(select sum(quantity_total) from public.treasury_loot) received")
 query((ROOT/'operations/inventory-positions.sql').read_text())
 after=query("select (select count(*) from public.treasury_sales) sales,(select count(*) from public.treasury_payouts) payouts,(select sum(quantity_remaining) from public.treasury_loot) physical,(select sum(quantity_total) from public.treasury_loot) received")
 assert before==after
 print('TWO_WAREHOUSE_SCHEMA_INSTALLED_WITH_PHYSICAL_STOCK_AND_MONEY_PRESERVED',flush=True)
checks=query("select not exists(select 1 from public.treasury_loot where xd_quantity<private.auction_reserved(id) or xd_quantity>quantity_remaining or xd_quantity<0) exact_positions,not has_function_privilege('authenticated','public.discard_inventory_stock_before_positions(uuid,uuid,integer,integer,text)','execute') legacy_disposal_private,not has_table_privilege('authenticated','public.inventory_transfers','insert') transfer_rpc_only,exists(select 1 from pg_trigger where tgname='position_sale' and not tgisinternal) sale_position_guard")
assert len(checks)==1 and all(checks[0].values())
print('GENERAL_AND_XD_POSITIONS_AND_SALES_GUARDS_VERIFIED',flush=True)
