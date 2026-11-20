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
import {ImportWorkflow,renderDraft} from './src/workflow.mjs';
for (const rosterPending of [true,false]) {
 let d={id:'check',owner:'check',step:'review',context:{},catalog:{members:[],activities:[],drops:[]},activity:{name:'Проверка',weight:100},mode:'raid',source:'prime',analyzed:true,roster:{members:[{id:'member',nickname:'Игрок'}],guests:[],unresolved:rosterPending?['Непрочитанный']:[]},loot:{items:[],unresolved:rosterPending?[]:['Непрочитанный предмет']}};
 const button=renderDraft(d).components.flatMap(row=>row.components).find(c=>c.custom_id?.endsWith(':confirm'));
 assert.equal(button.disabled,false);
 const errors=[];
 const flow=new ImportWorkflow({store:{get:()=>structuredClone(d),put:v=>{d=v}}});
 await flow.handle({customId:'xd:check:confirm',user:{id:'check'},deferUpdate:async()=>{},editReply:async()=>{},reply:async p=>errors.push(p),followUp:async p=>errors.push(p)});
 assert.equal(errors.length,1);assert.match(errors[0].content,rosterPending?/ники/:/предметы/);assert.equal(d.event,undefined);
}
console.log('SAVE_BUTTON_SMOKE_VERIFIED',JSON.stringify({enabled:true,incomplete_draft_explained:true,no_activity_created:true}));

"""
subprocess.run(['node','--input-type=module','-'],input=code,text=True,cwd=str(p),check=True)
print('ROSTER_BROWSE_RELEASE_VERIFIED',json.dumps({'revision':expected,'services_active':True}),flush=True)
'''.replace('EXPECTED_REVISION',revision)
r=subprocess.run(ssh+['python3 -'],input=script,text=True,timeout=660)
if r.returncode:raise SystemExit('ROSTER_BROWSE_VERIFICATION_FAILED')
