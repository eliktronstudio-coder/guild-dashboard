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

import shlex
assert os.environ.get('XD_RESET_CONFIRMATION')=='DELETE_ALL_ACTIVITIES_AND_TREASURY_20261111'
# The exact, fixed request ID in SQL prevents a workflow retry from clearing new data.
assert query("select to_regclass('public.treasury_pools') is null as no_optional_pools")[0]['no_optional_pools']
print('EXPLICIT_FULL_RESET_REQUEST_VERIFIED',flush=True)
query((ROOT/'operations/reset-guild-data.sql').read_text())
rows=query("select id,created_at,payload from private.xd_reset_backup_20261111 where id='4d73c8a1-0fb4-4caa-af6a-7db2b2419b43'")
assert len(rows)==1
backup=rows[0]
print('DELETED_RECORD_COUNTS',json.dumps({table:len(records) for table,records in backup['payload'].items()}),flush=True)
node=r"""
const fs=require('node:fs'),crypto=require('node:crypto'),zlib=require('node:zlib');
if(process.getuid()!==0)throw Error('Root-owned backup required');
process.umask(0o077);
const raw=fs.readFileSync(0),data=zlib.gzipSync(raw);
const keyDir='/root/.xd-reset-backup-keys',directory='/var/backups/xd-guild';
fs.mkdirSync(keyDir,{recursive:true,mode:0o700});fs.mkdirSync(directory,{recursive:true,mode:0o700});
const keyPath=keyDir+'/reset-20261111-4d73c8a1.key',file=directory+'/reset-20261111-4d73c8a1.json.gz.enc';
if(!fs.existsSync(file)){
 if(fs.existsSync(keyPath))throw Error('Incomplete previous encrypted backup');
 const key=crypto.randomBytes(32),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
 const encrypted=Buffer.concat([cipher.update(data),cipher.final()]);
 fs.writeFileSync(keyPath,key,{mode:0o600,flag:'wx'});
 fs.writeFileSync(file,Buffer.concat([Buffer.from('XDRESET1'),iv,cipher.getAuthTag(),encrypted]),{mode:0o600,flag:'wx'});
}
const saved=fs.readFileSync(file),key=fs.readFileSync(keyPath),decipher=crypto.createDecipheriv('aes-256-gcm',key,saved.subarray(8,20));
decipher.setAuthTag(saved.subarray(20,36));
const restored=zlib.gunzipSync(Buffer.concat([decipher.update(saved.subarray(36)),decipher.final()]));
if(!restored.equals(raw))throw Error('Backup read-back verification failed');
console.log('ENCRYPTED_RESET_BACKUP_VERIFIED',JSON.stringify({file,bytes:saved.length,sha256:crypto.createHash('sha256').update(saved).digest('hex')}));
"""
subprocess.run(SSH+['node -e '+shlex.quote(node)],input=json.dumps(backup,ensure_ascii=False,sort_keys=True),text=True,timeout=90,check=True)
checks=query("select not exists(select 1 from public.events where guild_id='00000000-0000-4000-8000-000000000001') activities_empty,not exists(select 1 from public.attendance where guild_id='00000000-0000-4000-8000-000000000001') attendance_empty,not exists(select 1 from public.treasury_loot where guild_id='00000000-0000-4000-8000-000000000001') both_inventories_empty,not exists(select 1 from public.treasury_sales where guild_id='00000000-0000-4000-8000-000000000001') sales_empty,not exists(select 1 from public.treasury_payouts where guild_id='00000000-0000-4000-8000-000000000001') payouts_empty,not exists(select 1 from public.period_archives where guild_id='00000000-0000-4000-8000-000000000001') archives_empty,private.fund_balance('00000000-0000-4000-8000-000000000001','prime')=0 prime_zero,private.fund_balance('00000000-0000-4000-8000-000000000001','mini_rb')=0 mini_zero,private.fund_balance('00000000-0000-4000-8000-000000000001','guild')=0 guild_zero")
assert len(checks)==1 and all(checks[0].values())
print('FULL_RESET_VERIFIED',json.dumps(checks[0]),flush=True)
