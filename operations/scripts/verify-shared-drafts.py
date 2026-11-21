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
const member={id:randomUUID(),nickname:'Ронин'},calls=[],memory=[];
let lost=true;
let d={id:'shared',owner:'creator',request:randomUUID(),context:{server:'synthetic',channel:'synthetic',user:'creator'},message:'123456789012345678',startsAt:'2026-11-20T00:00:00Z',step:'review',analyzed:true,activity:{id:randomUUID(),name:'Рейд',version:1,weight:100},mode:'raid',source:'prime',catalog:{members:[member],activities:[],drops:[]},roster:{members:[member],guests:[],unresolved:[]},loot:{items:[],unresolved:[]},lootRequests:{},evidence:[]};
const flow=new ImportWorkflow({store:{get:()=>structuredClone(d),put:v=>{d=structuredClone(v)},rememberNicknames:v=>memory.push(v)},site:async(op,p)=>{calls.push(structuredClone(p));if(lost){lost=false;throw Error('synthetic lost response');}return{event_id:'synthetic',url:'https://xd-guild.ru/events/synthetic'};}});
async function run(action,user,channel='synthetic'){
 const errors=[];
 await flow.handle({customId:'xd:shared:'+action,user:{id:user},guildId:'synthetic',channelId:channel,deferUpdate:async()=>{},editReply:async()=>{},reply:async p=>errors.push(p.content),followUp:async p=>errors.push(p.content)});
 return errors;
}
assert.equal((await run('confirm','editor','elsewhere')).length,1);assert.equal(d.step,'review');
flow.locks.add('shared');assert.match((await run('confirm','editor'))[0],/уже выполняется/);assert.equal(flow.locks.has('shared'),true);flow.locks.delete('shared');
assert.deepEqual(await run('confirm','editor'),[]);assert.equal(d.step,'confirm');assert.equal(d.context.user,'editor');
assert.equal((await run('publish','publisher-one')).length,1);
assert.deepEqual(await run('publish','publisher-two'),[]);
assert.equal(calls.length,2);assert.equal(calls[0].context.user,'publisher-one');assert.equal(calls[1].context.user,'publisher-two');assert.equal(calls[0].request,calls[1].request);assert.deepEqual(calls[0].activity,calls[1].activity);
assert.equal(memory[0].actor,'publisher-two');assert.equal(d.owner,'creator');assert.equal(d.event.event_id,'synthetic');
assert.deepEqual(await run('publish','third'),[]);assert.equal(calls.length,2);
console.log('SHARED_DRAFT_SMOKE_VERIFIED',JSON.stringify({other_participant_edits:true,other_participant_publishes:true,retry_preserves_request:true,no_duplicate:true,scope_enforced:true,locks_preserved:true,actual_actor_audited:true,no_real_activity_created:true,no_paid_calls:true}));
"""
subprocess.run(['node','--input-type=module','-'],input=code,text=True,cwd=str(p),check=True)
print('ROSTER_BROWSE_RELEASE_VERIFIED',json.dumps({'revision':expected,'services_active':True}),flush=True)
'''.replace('EXPECTED_REVISION',revision)
r=subprocess.run(ssh+['python3 -'],input=script,text=True,timeout=660)
if r.returncode:raise SystemExit('ROSTER_BROWSE_VERIFICATION_FAILED')
