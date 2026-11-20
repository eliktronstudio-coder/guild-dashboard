"""Enable unlimited daily recognition only after the compatible worker is deployed."""
import os,subprocess,re
revision=os.environ.get('XD_EXPECTED_VISION_REVISION','')
if not re.fullmatch('[a-f0-9]{40}',revision):raise SystemExit('EXPECTED_REVISION_MISSING')
ssh=['ssh','-i',os.path.expanduser('~/.ssh/xd_operations'),'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=20','root@200.165.236.194']
script=r'''
import os,pathlib,subprocess,time,tempfile,stat,re,json,sqlite3
expected='EXPECTED_REVISION'
for attempt in range(60):
 if pathlib.Path('/var/lib/xd-guild-deploy/deployed').read_text().strip()==expected and pathlib.Path('/var/lib/xd-discord-bot/deployed').read_text().strip()==expected:break
 if attempt%6==0:print('WAITING_UNLIMITED_WORKER_RELEASE',attempt+1,flush=True)
 time.sleep(10)
else:raise SystemExit('WORKER_RELEASE_NOT_READY')
p=pathlib.Path('/etc/xd-discord-bot.env');original=p.read_bytes();text=original.decode();st=p.stat()
pattern=re.compile(r'^\s*OPENAI_DAILY_LIMIT\s*=')
others=[line for line in text.splitlines(keepends=True) if not pattern.match(line)]
updated=('OPENAI_DAILY_LIMIT=unlimited\n'+''.join(others)).encode()
assert [line for line in updated.decode().splitlines(keepends=True) if not pattern.match(line)]==others
state=pathlib.Path('/var/lib/xd-discord-bot/drafts.sqlite')
con=sqlite3.connect('file:'+str(state)+'?mode=ro',uri=True);before=con.execute('select count(*) from vision_usage').fetchone()[0];con.close()
def write(value):
 fd,name=tempfile.mkstemp(prefix='.xd-discord-env-',dir='/etc')
 try:
  os.fchmod(fd,stat.S_IMODE(st.st_mode));os.fchown(fd,st.st_uid,st.st_gid)
  with os.fdopen(fd,'wb') as f:f.write(value)
  os.replace(name,p)
 finally:
  if os.path.exists(name):os.unlink(name)
try:
 if updated!=original:
  if p.read_bytes()!=original:raise RuntimeError('ENV_CONCURRENT_EDIT')
  write(updated);subprocess.run(['systemctl','restart','xd-discord-bot'],check=True)
 subprocess.run(['systemctl','is-active','--quiet','xd-discord-bot'],check=True)
 pairs={}
 for attempt in range(20):
  pid=subprocess.check_output(['systemctl','show','xd-discord-bot','--property=MainPID','--value'],text=True).strip()
  try:pairs=dict(v.split('=',1) for v in pathlib.Path('/proc/'+pid+'/environ').read_bytes().decode().split(chr(0)) if '=' in v)
  except OSError:pairs={}
  if len(pairs.get('DISCORD_IMPORT_SECRET',''))>=32 and pairs.get('XD_SITE_ORIGIN')=='https://xd-guild.ru':break
  time.sleep(0.5)
 else:raise RuntimeError('WORKER_ENVIRONMENT_NOT_READY')
 cwd=subprocess.check_output(['systemctl','show','xd-discord-bot','--property=WorkingDirectory','--value'],text=True).strip()
 code=r"""
import {visionConfig} from './src/vision.mjs';
import {renderDraft} from './src/workflow.mjs';
const c=visionConfig();
if(c.daily!==null||c.concurrent!==2||c.monthlyMicros!==5000000)throw Error('WORKER_BUDGET_CONFIGURATION_INVALID');
const m=renderDraft({event:{url:'https://xd-guild.ru/events/test'},publication:{activity:{title:'Проверка',coefficient:'1.00'}},savedAt:'2026-11-19T21:30:00Z'});
if(!m.content.includes('20.11.2026, 00:30 (МСК)')||m.content.includes('Екатеринбург'))throw Error('MOSCOW_TEMPLATE_INVALID');
console.log('WORKER_UNLIMITED_MSK_VERIFIED',JSON.stringify({daily:c.daily,concurrent:c.concurrent,monthly_budget_usd:c.monthlyMicros/1e6,creation_timezone:'Europe/Moscow'}));
"""
 subprocess.run(['node','--input-type=module','-'],input=code,text=True,cwd=cwd,env=pairs,check=True)
 con=sqlite3.connect('file:'+str(state)+'?mode=ro',uri=True);after=con.execute('select count(*) from vision_usage').fetchone()[0];con.close();assert after>=before
 print('ENV_AND_LEDGER_PRESERVED',json.dumps({'other_environment_lines_unchanged':True,'persistent_usage_preserved':True,'no_inference_requested':True}),flush=True)
except Exception:
 if p.read_bytes()==updated:
  write(original);subprocess.run(['systemctl','restart','xd-discord-bot'],check=True)
 raise
'''.replace('EXPECTED_REVISION',revision)
r=subprocess.run(ssh+['python3 -'],input=script,text=True,timeout=780)
if r.returncode:raise SystemExit('UNLIMITED_WORKER_VERIFICATION_FAILED')
