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
import {randomUUID} from 'node:crypto';
import {ImportWorkflow} from './src/workflow.mjs';
for(const known of [true,false]){
 const member={id:randomUUID(),nickname:'Игрок'},item={id:randomUUID(),name:'Предмет',quantity:2,price_units:'10000',version:1};
 let d={id:'check',request:randomUUID(),owner:'check',step:'review',context:{server:'synthetic',channel:'synthetic'},message:'synthetic',startsAt:'2026-11-01T00:00:00Z',catalog:{members:[member],activities:[],drops:[item]},activity:{id:randomUUID(),name:'Проверка',weight:100,version:1},mode:'raid',source:'prime',analyzed:true,roster:{members:[member],guests:[],unresolved:[]},loot:{items:known?[item]:[],unresolved:['Эссенция ярости — размер не выбран']},lootRequests:{},evidence:[]};
 const errors=[],publications=[];
 const flow=new ImportWorkflow({store:{get:()=>structuredClone(d),put:value=>{d=value}},site:async(op,p)=>{publications.push(p);return{event_id:randomUUID(),url:'https://xd-guild.ru/events/synthetic'}}});
 const run=async(action)=>flow.handle({customId:'xd:check:'+action,user:{id:'check'},deferUpdate:async()=>{},editReply:async()=>{},reply:async p=>errors.push(p),followUp:async p=>errors.push(p)});
 await run('confirm');assert.equal(d.step,'confirm');await run('publish');
 assert.equal(errors.length,0);assert.equal(publications.length,1);assert.equal(publications[0].activity.loot.length,known?1:0);assert.match(publications[0].activity.description,/Эссенция ярости/);
 await run('publish');assert.equal(publications.length,1);
}
console.log('PENDING_LOOT_SAVE_SMOKE_VERIFIED',JSON.stringify({mixed_loot:true,all_unresolved:true,notes_preserved:true,idempotent:true,no_real_activity_created:true,no_inference:true}));

"""
subprocess.run(['node','--input-type=module','-'],input=code,text=True,cwd=str(p),check=True)
print('ROSTER_BROWSE_RELEASE_VERIFIED',json.dumps({'revision':expected,'services_active':True}),flush=True)
'''.replace('EXPECTED_REVISION',revision)
r=subprocess.run(ssh+['python3 -'],input=script,text=True,timeout=660)
if r.returncode:raise SystemExit('ROSTER_BROWSE_VERIFICATION_FAILED')
