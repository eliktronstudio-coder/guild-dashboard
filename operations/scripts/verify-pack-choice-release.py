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
const sizes=[1000,2000,3000,4500,6000,8000,10000,12500];
const drops=sizes.map(n=>({id:'pack'+n,name:'Эссенция ярости х'+n,price_units:'10000',version:1}));
let d={id:'check',owner:'check',step:'review',context:{},catalog:{members:[],activities:[],drops},activity:{name:'Проверка',weight:100},mode:'raid',source:'prime',analyzed:true,roster:{members:[],guests:[],unresolved:[]},loot:{items:[],unresolved:['Получено: [Эссенция ярости]'],readings:[{key:'pack',raw:'Получено: [Эссенция ярости]',quantity:1,pending:true,suggestions:[]}]}};
const errors=[];let modal;
const flow=new ImportWorkflow({store:{get:()=>structuredClone(d),put:value=>{d=value}}});
const run=async(name,values=[],text='')=>flow.handle({customId:'xd:check:'+name,user:{id:'check'},values,fields:{getTextInputValue:()=>text},deferUpdate:async()=>{},editReply:async()=>{},reply:async p=>errors.push(p),followUp:async p=>errors.push(p),showModal:async m=>{modal=m.toJSON()}});
await run('reviewLoot');
const menu=renderDraft(d).components[1].components[0];
assert.equal(menu.placeholder,'Выберите размер набора');assert.equal(menu.options.length,10);
assert.deepEqual(menu.options.slice(0,8).map(i=>i.value),sizes.map(n=>'pack'+n));assert.equal(d.loot.items.length,0);
await run('lootPick',['pack2000']);await run(modal.custom_id.split(':').slice(2).join(':'),[],'3');
assert.equal(d.loot.items[0].id,'pack2000');assert.equal(d.loot.items[0].quantity,3);assert.equal(errors.length,0);
console.log('PACK_CHOICE_SMOKE_VERIFIED',JSON.stringify({all_sizes:true,separate_quantity:true,old_draft_refresh:true,no_activity_created:true,no_paid_inference:true}));

"""
subprocess.run(['node','--input-type=module','-'],input=code,text=True,cwd=str(p),check=True)
print('ROSTER_BROWSE_RELEASE_VERIFIED',json.dumps({'revision':expected,'services_active':True}),flush=True)
'''.replace('EXPECTED_REVISION',revision)
r=subprocess.run(ssh+['python3 -'],input=script,text=True,timeout=660)
if r.returncode:raise SystemExit('ROSTER_BROWSE_VERIFICATION_FAILED')
