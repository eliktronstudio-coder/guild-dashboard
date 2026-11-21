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
import sharp from 'sharp';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {draftStore} from './src/store.mjs';
import {createVisionRecognizer} from './src/vision.mjs';
import {recognizeIndependentRoster} from './src/recognition.mjs';
const dir=mkdtempSync(join(tmpdir(),'xd-roster-match-check-')),store=draftStore(dir);
let calls=0;
const players=['Potatoo','Слакислаки','Cartel','UncertainPlayer'].map((visible,slot)=>({slot,visible,truncated:false,uncertain:slot===3,group:1}));
const members=[{id:'p',nickname:'Potatooo'},{id:'a',nickname:'Aniris',aliases:['Слакислаки']},{id:'c1',nickname:'Cartell'},{id:'c2',nickname:'Cartelll'},{id:'u',nickname:'UncertainPlayer'}];
try{
 const buffer=await sharp({create:{width:100,height:40,channels:3,background:'#235bad'}}).png().toBuffer();
 const recognize=createVisionRecognizer({store,env:{OPENAI_API_KEY:'synthetic-not-a-real-key'},regions:async()=>({boxes:[]}),log:()=>{},client:{responses:{create:async()=>{calls++;return{status:'completed',output_text:JSON.stringify({players}),usage:{input_tokens:0,output_tokens:0}};}}}});
 const result=await recognize(buffer,{roster:true,scope:'synthetic'});
 assert.equal(result.engine,'gpt');
 const roster=recognizeIndependentRoster(result.words,members,{recall:r=>r.visible==='Слакислаки'?{name:'Слакислаки'}:{}});
 assert.deepEqual(roster.members.map(m=>m.id),['p','a']);assert.deepEqual(roster.guests,[]);assert.deepEqual(roster.unresolved,['Cartel','UncertainPlayer']);
 await recognize(buffer,{roster:true,scope:'synthetic'});assert.equal(calls,1);
 const retried=await recognize(buffer,{roster:true,scope:'synthetic',retryCells:result.words.map(w=>({slotKey:w.slotKey,box:w.box}))});
 assert.equal(retried.engine,'gpt');assert.equal(retried.words[0].slotKey,result.words[0].slotKey);assert.equal(calls,2);
 console.log('ROSTER_AUTOMATCH_SMOKE_VERIFIED',JSON.stringify({whole_image:true,similar:true,rename_alias:true,ambiguous_kept_pending:true,real_uncertainty_preserved:true,cache:true,retry:true,no_paid_calls:true,no_production_drafts_read:true}));
}finally{store.close();rmSync(dir,{recursive:true,force:true});}
"""
subprocess.run(['node','--input-type=module','-'],input=code,text=True,cwd=str(p),check=True)
print('ROSTER_BROWSE_RELEASE_VERIFIED',json.dumps({'revision':expected,'services_active':True}),flush=True)
'''.replace('EXPECTED_REVISION',revision)
r=subprocess.run(ssh+['python3 -'],input=script,text=True,timeout=660)
if r.returncode:raise SystemExit('ROSTER_BROWSE_VERIFICATION_FAILED')
