"""Populate the user's 18 activity banners on the verified xd-guild.ru project."""
import os,json,re,subprocess,urllib.parse,urllib.request,urllib.error,pathlib,hashlib,base64,struct
from decimal import Decimal
from activity_import_sql import statement
ROOT=pathlib.Path(__file__).resolve().parents[2]
IMPORT_ID='xd-user-activity-list-20261109-18'
GUILD='00000000-0000-4000-8000-000000000001'
rows=json.loads((ROOT/'operations/imports/20261109-activity-banners.json').read_text())
coefficients=dict(line.split('\t') for line in (ROOT/'operations/imports/20261109-activity-coefficients.tsv').read_text().splitlines())
assert len(rows)==18 and len({r['name'] for r in rows})==18 and set(coefficients)=={r['name'] for r in rows}
assert sum(r['weight'] for r in rows)==1400
for r in rows:
 assert r['weight']==int(Decimal(coefficients[r['name']])*100) and 1<=r['weight']<=100000
 data=base64.b64decode(r['photo'].split(',')[1],validate=True)
 assert r['photo'].startswith('data:image/png;base64,') and len(r['photo'])<=500000 and data[:8]==b'\x89PNG\r\n\x1a\n'
 assert struct.unpack('>II',data[16:24])==(480,180) and hashlib.sha256(data).hexdigest()==r['source']['banner_sha256']
 assert r['source']['page'].startswith(('https://archeage.ru/','https://www.4gamer.net/'))
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
def norm(name):return re.sub(r'[^\w\d]+',' ',name.casefold().replace('ё','е')).strip()
existing=query("select id,name,photo,weight,version from public.guild_activity_banners where guild_id='"+GUILD+"'")
ledger={r['target_id'] for r in query("select target_id from public.audit_log where guild_id='"+GUILD+"' and detail->>'import_id'='"+IMPORT_ID+"'")}
for r in rows:
 names={norm(n) for n in [r['name'],*r['aliases']]}
 matches=[e for e in existing if norm(e['name']) in names]
 if len(matches)>1:raise SystemExit('Ambiguous existing activity names; import cancelled')
 if matches:r['id']=matches[0]['id'];r['expected_version']=matches[0]['version']
 else:r['expected_version']=0
 if r['id'] in ledger and not(matches and all(matches[0][k]==r[k] for k in ['name','weight','photo'])):raise SystemExit('An imported banner was edited later; replay cancelled')
print('ACTIVITY_IMPORT_PLAN',json.dumps({'items':len(rows),'new':sum(r['expected_version']==0 for r in rows),'existing':sum(r['expected_version']>0 for r in rows)}),flush=True)
for i,r in enumerate(rows,1):
 query(statement(r,GUILD,IMPORT_ID))
 print('ACTIVITY_BANNER_COMMITTED',i,r['name'],r['coefficient'],flush=True)
after=query("select id,name,photo,weight from public.guild_activity_banners where guild_id='"+GUILD+"'")
for r in rows:
 found=[e for e in after if e['id']==r['id']]
 assert len(found)==1 and all(found[0][k]==r[k] for k in ['name','weight','photo']),'Banner verification failed'
print('ACTIVITY_IMPORT_VERIFIED',json.dumps({'matched':len(rows),'photos':sum(bool(r['photo']) for r in rows),'weight_units_total':sum(r['weight'] for r in rows)}),flush=True)
