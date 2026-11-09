"""Import exactly the reviewed user list into the production guild's drop registry."""
import os,json,re,subprocess,urllib.parse,urllib.request,urllib.error,pathlib,hashlib,base64,struct
ROOT=pathlib.Path(__file__).resolve().parents[2]
FILE=ROOT/'operations/imports/20261109-drop-registry.json'
IMPORT_ID='xd-user-drop-list-20261109-75'
GUILD='00000000-0000-4000-8000-000000000001'
rows=json.loads(FILE.read_text())
user_prices=dict(line.split('\t') for line in (ROOT/'operations/imports/20261109-user-prices.tsv').read_text().splitlines())
assert set(user_prices)=={r['name'] for r in rows}
assert all(r['price_units']==str(int(user_prices[r['name']])*10000) for r in rows)
assert len(rows)==75 and len({r['name'] for r in rows})==75
for r in rows:
 b=base64.b64decode(r['photo'].split(',')[1],validate=True)
 assert r['photo'].startswith('data:image/png;base64,') and b[:8]==b'\x89PNG\r\n\x1a\n'
 assert len(r['photo'])<=100000 and hashlib.sha256(b).hexdigest()==r['source']['sha256']
 assert struct.unpack('>II',b[16:24])==(r['source']['width'],r['source']['height'])
 assert r['source']['page'].startswith('https://archeagecodex.com/ru/item/')
 assert re.fullmatch(r'\d+',r['price_units']) and 0<=int(r['price_units'])<=100000000000000
SSH=['ssh','-i',os.path.expanduser('~/.ssh/xd_operations'),'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=20','root@200.165.236.194']
remote='app=$(systemctl show xd-guild --property=WorkingDirectory --value); cd "$app"; node'
source="require('@next/env').loadEnvConfig(process.cwd());console.log(JSON.stringify({origin:process.env.APP_ORIGIN,url:process.env.NEXT_PUBLIC_SUPABASE_URL}));"
result=subprocess.run(SSH+[remote],input=source,text=True,capture_output=True,timeout=45,check=True)
target=json.loads(result.stdout)
assert target.get('origin')=='https://xd-guild.ru','Unexpected production origin'
url=urllib.parse.urlsplit(target['url']);ref=url.hostname.removesuffix('.supabase.co')
assert url.scheme=='https' and url.hostname.endswith('.supabase.co') and re.fullmatch('[a-z0-9]{20}',ref),'Unexpected project URL'
def query(sql):
 request=urllib.request.Request('https://api.supabase.com/v1/projects/'+ref+'/database/query',data=json.dumps({'query':sql}).encode(),headers={'Authorization':'Bearer '+os.environ['SUPABASE_ACCESS_TOKEN'],'Content-Type':'application/json'},method='POST')
 try:
  with urllib.request.urlopen(request,timeout=90) as response:return json.load(response)
 except urllib.error.HTTPError as error:
  # Never log response bodies: a failing row can contain the uploaded image or catalog data.
  print('SUPABASE_SQL_HTTP_ERROR',error.code)
  raise SystemExit(1)
def normalized(name):
 name=re.sub(r'\s+[xх](\d+)$',r' x\1',name.casefold().replace('ё','е').replace('любимица','любимца'))
 return re.sub(r'[^\w\d]+',' ',name).strip()
existing=query("select id,name,price_units::text,photo,version from public.guild_drop_registry where guild_id='"+GUILD+"'")
ledger=query("select count(*)::int as count from public.audit_log where guild_id='"+GUILD+"' and detail->>'import_id'='"+IMPORT_ID+"'")[0]['count']
for r in rows:
 matches=[e for e in existing if normalized(e['name'])==normalized(r['name'])]
 if len(matches)>1:raise SystemExit('Ambiguous existing catalog names; import cancelled')
 if matches:r['id']=matches[0]['id'];r['expected_version']=matches[0]['version']
 else:r['expected_version']=0
if ledger:
 if not all(any(e['id']==r['id'] and e['name']==r['name'] and e['price_units']==r['price_units'] and e['photo']==r['photo'] for e in existing) for r in rows):raise SystemExit('Import already applied; later catalog edits will not be overwritten')
 print('USER_DROP_IMPORT_ALREADY_VERIFIED',len(rows))
else:
 payload=json.dumps(rows,ensure_ascii=False)
 assert '$xd_payload$' not in payload and '$xd_import$' not in payload
 sql="""begin;
lock table public.guild_drop_registry in share row exclusive mode;
do $xd_import$
declare payload jsonb:=$xd_payload$"""+payload+"""$xd_payload$::jsonb;
 entry jsonb; old public.guild_drop_registry; target_guild uuid:='00000000-0000-4000-8000-000000000001';
begin
 if exists(select 1 from public.audit_log where guild_id=target_guild and detail->>'import_id'='xd-user-drop-list-20261109-75') then raise exception 'IMPORT_ALREADY_APPLIED'; end if;
 for entry in select value from jsonb_array_elements(payload) loop
  select * into old from public.guild_drop_registry where id=(entry->>'id')::uuid for update;
  if old.id is null then
   if (entry->>'expected_version')::integer<>0 then raise exception 'IMPORT_STALE_VERSION'; end if;
   insert into public.guild_drop_registry(id,guild_id,name,photo,price_units) values((entry->>'id')::uuid,target_guild,entry->>'name',entry->>'photo',(entry->>'price_units')::bigint);
  else
   if old.guild_id<>target_guild or old.version<>(entry->>'expected_version')::integer then raise exception 'IMPORT_STALE_VERSION'; end if;
   if old.name=entry->>'name' and old.photo=entry->>'photo' and old.price_units=(entry->>'price_units')::bigint then continue; end if;
   update public.guild_drop_registry set name=entry->>'name',photo=entry->>'photo',price_units=(entry->>'price_units')::bigint,version=version+1 where id=old.id;
  end if;
  insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(target_guild,null,'drop_registry.saved',(entry->>'id')::uuid,jsonb_build_object('import_id','xd-user-drop-list-20261109-75','actor','authorized_catalog_import','name',entry->>'name','price_units',entry->>'price_units','source',entry->'source','before',case when old.id is null then null else to_jsonb(old) end));
 end loop;
end $xd_import$;
commit;"""
 # Dry-run output contains only the reviewed catalog, never credentials.
 (ROOT/'operations/imports/reviewed-drop-import.sql').write_text(sql)
 print('USER_DROP_IMPORT_PLAN',json.dumps({'items':len(rows),'new':sum(r['expected_version']==0 for r in rows),'existing':sum(r['expected_version']>0 for r in rows),'zero_prices':sum(int(r['price_units'])==0 for r in rows)}))
 query(sql)
 print('USER_DROP_IMPORT_COMMITTED')
after=query("select id,name,price_units::text,photo from public.guild_drop_registry where guild_id='"+GUILD+"'")
for r in rows:
 match=[e for e in after if e['id']==r['id']]
 assert len(match)==1 and all(match[0][k]==r[k] for k in ['name','price_units','photo']),'Imported record verification failed'
print('USER_DROP_IMPORT_VERIFIED',json.dumps({'matched_items':len(rows),'with_original_icons':sum(bool(r['photo']) for r in rows),'zero_prices':sum(int(r['price_units'])==0 for r in rows),'price_units_total':str(sum(int(r['price_units']) for r in rows))}))
