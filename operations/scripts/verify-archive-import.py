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

import hashlib,base64,datetime,collections
# Only the explicit source caption '+ стакистаки' supplements an entirely cropped slot.
caption_records=[r for r in records if '+ стакистаки' in r['payload']['description'].lower()]
for r in caption_records:
 target=query("select id from public.memberships where nickname='Стакистаки' and status='active'");assert len(target)==1
 member=target[0]['id'];assert member in r['payload']['members']
 mark=query('select mark,version from public.attendance where event_id='+quoted(r['id'])+'::uuid and membership_id='+quoted(member)+'::uuid');assert len(mark)==1
 if mark[0]['mark']=='absent':
  sql="begin isolation level repeatable read;"+GUARD+"select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);select set_config('xd.discord_actor',(select m.user_id::text from public.discord_settings s join public.memberships m on m.id=s.import_membership_id and m.guild_id=s.guild_id where s.guild_id=(select id from public.guilds where slug='xd')),true);"
  sql+='select public.mark_attendance('+quoted(r['id'])+'::uuid,'+quoted(member)+'::uuid,'+str(mark[0]['version'])+",'present',"+quoted('Участник Стакистаки явно указан в исходной подписи «левик + стакистаки»; первый слот скриншота обрезан.')+');'
  sql+='update public.events set description=description||E\'\\nСтакистаки учтён по явной подписи источника «левик + стакистаки».\',version=version+1 where id='+quoted(r['id'])+'::uuid;'+VERIFY+'commit;'
  query(sql)
  print('EXPLICIT_CAPTION_PARTICIPANT_RECORDED',r['id'],flush=True)
ids=','.join(quoted(r['id'])+'::uuid' for r in records)
actual=query("select e.id,e.title,e.starts_at,e.kind,e.treasury_source,e.activity_weight,e.status,e.deleted_at,e.counts_for_attendance,e.inventory_receipt,coalesce((select jsonb_agg(a.membership_id) from public.attendance a where a.event_id=e.id and a.mark='present'),'[]') members,coalesce((select r.guests from public.activity_reports r where r.event_id=e.id),'[]') guests,coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'kind',v.kind,'digest',md5(decode(split_part(v.image,',',2),'base64')))) from public.activity_evidence v where v.event_id=e.id),'[]') images,coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'catalog',l.catalog_id,'quantity',l.quantity_total,'source',l.source)) from public.treasury_loot l where l.event_id=e.id),'[]') loot from public.events e where e.id in ("+ids+")")
assert len(actual)==len(records)==170
byid={v['id']:v for v in actual};extra_members=0
for r in records:
 p=r['payload'];a=byid[r['id']]
 assert a['title']==p['title'] and a['kind']==p['kind'] and a['treasury_source']==p['source'] and a['activity_weight']==p['weight']
 assert datetime.datetime.fromisoformat(a['starts_at'])==datetime.datetime.fromisoformat(p['starts_at'])
 assert a['status']=='completed' and a['deleted_at'] is None and a['counts_for_attendance'] and not a['inventory_receipt']
 assert set(p['members'])<=set(a['members'])
 extra_members+=len(set(a['members'])-set(p['members']))
 assert set(p['guests'])<=set(a['guests'])
 images={x['id']:x for x in a['images']};assert len(images)==len(p['evidence'])
 for image in p['evidence']:
  assert images[image['id']]['kind']==image['kind'] and images[image['id']]['digest']==hashlib.md5(base64.b64decode(image['image'].split(',',1)[1])).hexdigest()
 loot={x['id']:x for x in a['loot']};assert len(loot)==len(p['loot'])
 for item in p['loot']:assert loot[item['request_id']]['catalog']==item['id'] and loot[item['request_id']]['quantity']==item['quantity'] and loot[item['request_id']]['source']==p['source']
summary={'activities':len(actual),'registered_attendance_marks':sum(len(a['members']) for a in actual),'guests':sum(len(a['guests']) for a in actual),'images':sum(len(a['images']) for a in actual),'catalog_loot_rows':sum(len(a['loot']) for a in actual),'prime':sum(a['treasury_source']=='prime' for a in actual),'mini_rb':sum(a['treasury_source']=='mini_rb' for a in actual),'pvp':sum(a['kind']=='pvp' for a in actual),'later_user_added_participants_preserved':extra_members,'paid_recognition_requests':0}
(ROOT/'archive-verification.json').write_text(json.dumps({'summary':summary,'records':[{'source':r['source'],'event_id':r['id'],'url':'https://xd-guild.ru/events/'+r['id']} for r in records]},ensure_ascii=False,indent=2))
print('ARCHIVE_FINAL_VERIFIED',json.dumps(summary,ensure_ascii=False),flush=True)
