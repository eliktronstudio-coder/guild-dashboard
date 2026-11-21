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
import shutil,os,urllib.request
with urllib.request.urlopen('https://xd-gpt-vision.onrender.com/health',timeout=45) as r:health=json.load(r)
assert {'loot-vision-v1','gpt-only'}.issubset(set(health.get('capabilities',[])))
p=pathlib.Path('/var/www/xd-discord-bot/current')
code=r"""
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createVisionRecognizer} from './src/vision.mjs';
import {recognizeVisionLoot,resolveLoot} from './src/loot-review.mjs';
const cache=new Map(),requests=new Map();
const store={visionCached:(scope,key)=>cache.get(scope+':'+key),visionReserve:(scope,key)=>{const id=randomUUID();requests.set(id,scope+':'+key);return{id}},visionFinish:(id,data)=>{if(data.result)cache.set(requests.get(id),data.result)}};
let calls=0;
const client={responses:{create:async body=>{calls++;return{status:'completed',output_text:JSON.stringify(body.text.format.name==='activity_loot'?{items:[{slot:0,visible:'Эссенция ярости',quantity:1,uncertain:false},{slot:1,visible:'Эссенция ярости',quantity:2,uncertain:false}]}:{players:[{slot:0,visible:'ИгрокX',uncertain:false,truncated:false,group:1}]}),usage:{input_tokens:1,output_tokens:1}}}}};
const image=await sharp({create:{width:100,height:40,channels:3,background:'#222'}}).png().toBuffer();
const recognize=createVisionRecognizer({store,env:{OPENAI_API_KEY:'mock-not-a-real-key'},client,regions:async()=>({boxes:[]}),log:()=>{}});
const loot=await recognize(image,{loot:true,scope:'verify'});assert.equal(loot.engine,'gpt');assert.equal(loot.lootItems.length,2);
await recognize(image,{loot:true,scope:'verify'});assert.equal(calls,1);
const roster=await recognize(image,{roster:true,scope:'verify'});assert.equal(roster.engine,'gpt');assert.equal(roster.words[0].text,'ИгрокX');assert.equal(calls,2);
const d={catalog:{drops:[{id:'small',name:'Эссенция ярости х1000'},{id:'big',name:'Эссенция ярости х2000'}]},loot:recognizeVisionLoot(loot.lootItems,[{id:'small',name:'Эссенция ярости х1000'},{id:'big',name:'Эссенция ярости х2000'}])};
assert.equal(d.loot.unresolved.length,2);resolveLoot(d,d.loot.readings[0].key,'small',1);resolveLoot(d,d.loot.readings[1].key,'big',2);assert.equal(d.loot.items.length,2);
const fail=createVisionRecognizer({store,env:{OPENAI_API_KEY:'mock'},client:{responses:{create:async()=>{throw{status:429}}}},log:()=>{}});
const error=await fail(image,{loot:true,scope:'failure'});assert.equal(error.failed,true);assert.equal(error.engine,'unavailable');assert.ok(!error.notice.includes('Tesseract'));
assert.ok(!readFileSync('src/index.mjs','utf8').includes('./ocr.mjs'));
console.log('GPT_ONLY_WORKER_SMOKE_VERIFIED',JSON.stringify({roster:true,loot:true,cache:true,separate_occurrences:true,manual_failure:true,no_tesseract:true,no_inference:true,no_activity_created:true}));
"""
node=shutil.which('node');assert node
# Deliberately remove all executable search paths. No local OCR can be launched.
subprocess.run([node,'--input-type=module','-'],input=code,text=True,cwd=str(p),env={**os.environ,'PATH':'/no-external-executables'},check=True)
print('ROSTER_BROWSE_RELEASE_VERIFIED',json.dumps({'revision':expected,'services_active':True}),flush=True)
'''.replace('EXPECTED_REVISION',revision)
r=subprocess.run(ssh+['python3 -'],input=script,text=True,timeout=660)
if r.returncode:raise SystemExit('ROSTER_BROWSE_VERIFICATION_FAILED')
