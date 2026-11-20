"""Verify deployed draft membership editing without Discord messages or activity writes."""
import os,re,subprocess
revision=os.environ.get('XD_EXPECTED_BOT_REVISION','')
if not re.fullmatch('[a-f0-9]{40}',revision):raise SystemExit('EXPECTED_REVISION_MISSING')
ssh=['ssh','-i',os.path.expanduser('~/.ssh/xd_operations'),'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=20','root@200.165.236.194']
script=r'''
import pathlib,subprocess,time,json
expected='EXPECTED_REVISION'
for attempt in range(60):
 if pathlib.Path('/var/lib/xd-guild-deploy/deployed').read_text().strip()==expected and pathlib.Path('/var/lib/xd-discord-bot/deployed').read_text().strip()==expected:break
 if attempt%6==0:print('WAITING_ROSTER_BROWSE_RELEASE',attempt+1,flush=True)
 time.sleep(10)
else:raise SystemExit('ROSTER_BROWSE_RELEASE_NOT_DEPLOYED')
for unit in ['xd-guild','xd-discord-bot','xd-guild-deploy.timer']:
 subprocess.run(['systemctl','is-active','--quiet',unit],check=True)
p=pathlib.Path('/var/www/xd-discord-bot/current')
code=r"""
import assert from 'node:assert/strict';
import {recognizeIndependentRoster} from './src/recognition.mjs';
const check=(text,names,extra={})=>recognizeIndependentRoster([{text,confidence:96,engine:'gpt',kind:'raid-cell',slotKey:'one',unbiased:true,...extra}],names.map((nickname,i)=>({id:String(i),nickname})));
const r=check('Cartell',['Cartelll']);assert.equal(r.members[0].nickname,'Cartelll');assert.equal(r.readings[0].visible,'Cartell');assert.equal(r.readings[0].status,'автосопоставлено');
assert.equal(check('Cartel',['Cartell','Cartelll']).unresolved.length,1);
assert.equal(check('Cartell',['Cartelll'],{uncertain:true}).unresolved.length,1);
console.log('AUTOMATIC_NICKNAME_MATCHING_VERIFIED');

"""
subprocess.run(['node','--input-type=module','-'],input=code,text=True,cwd=str(p),check=True)
print('ROSTER_BROWSE_RELEASE_VERIFIED',json.dumps({'revision':expected,'services_active':True}),flush=True)
'''.replace('EXPECTED_REVISION',revision)
r=subprocess.run(ssh+['python3 -'],input=script,text=True,timeout=660)
if r.returncode:raise SystemExit('ROSTER_BROWSE_VERIFICATION_FAILED')
