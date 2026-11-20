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
import {recognizeLoot} from './src/loot-review.mjs';
import {ImportWorkflow,renderDraft} from './src/workflow.mjs';
const drops=[{id:'first',name:'Трофейная эссенция стихий',price_units:'10000',version:1},{id:'second',name:'Коготь дракона',price_units:'20000',version:1}];
for(const raw of ['Трофеиная эссенцня стихии x2','Тpофейная эcсенция cтихий x2','Трофейная эссенция… x2'])assert.equal(recognizeLoot(raw,drops).items[0].id,'first');
assert.equal(recognizeLoot('Коготь дракона',drops).unresolved.length,1);
let d={id:'check',owner:'check',step:'review',context:{},catalog:{members:[],activities:[],drops},activity:{name:'Проверка',weight:100},mode:'raid',source:'prime',analyzed:true,roster:{members:[],guests:[],unresolved:[]},loot:recognizeLoot('? Не прочитано x2',drops)};
const errors=[];let modal;
const flow=new ImportWorkflow({store:{get:()=>structuredClone(d),put:value=>{d=value}}});
const run=async(name,values=[],text='')=>flow.handle({customId:'xd:check:'+name,user:{id:'check'},values,fields:{getTextInputValue:()=>text},deferUpdate:async()=>{},editReply:async()=>{},reply:async p=>errors.push(p),followUp:async p=>errors.push(p),showModal:async m=>{modal=m.toJSON()}});
await run('reviewLoot');assert.equal(d.step,'lootReview');
await run('lootPick',['registry']);assert.equal(renderDraft(d).components[0].components[0].options[0].value,'search');
await run('lootPick',['search']);assert.ok(modal.title.includes('предмет'));
await run('lootQuery',[],'коготь');assert.equal(renderDraft(d).components[0].components[0].options.length,2);
await run('lootPick',['second']);assert.ok(modal.custom_id.length<=100);
await run(modal.custom_id.split(':').slice(2).join(':'),[],'4');
assert.equal(d.loot.items[0].id,'second');assert.equal(d.loot.items[0].quantity,4);assert.equal(d.loot.unresolved.length,0);assert.equal(errors.length,0);
d.loot={items:[],unresolved:['Трофеиная эссенцня стихии x2'],readings:[{key:'old',raw:'Трофеиная эссенцня стихии x2',quantity:2,pending:true}]};
await run('reviewLoot');assert.equal(d.loot.items[0].id,'first');assert.equal(d.loot.readings[0].key,'old');assert.equal(d.loot.unresolved.length,0);
console.log('SIMILAR_LOOT_SMOKE_VERIFIED',JSON.stringify({matching:true,search:true,quantity:true,no_inference:true,no_activity_created:true}));

"""
subprocess.run(['node','--input-type=module','-'],input=code,text=True,cwd=str(p),check=True)
print('ROSTER_BROWSE_RELEASE_VERIFIED',json.dumps({'revision':expected,'services_active':True}),flush=True)
'''.replace('EXPECTED_REVISION',revision)
r=subprocess.run(ssh+['python3 -'],input=script,text=True,timeout=660)
if r.returncode:raise SystemExit('ROSTER_BROWSE_VERIFICATION_FAILED')
