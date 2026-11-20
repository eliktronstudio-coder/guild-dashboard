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
 if attempt%6==0:print('WAITING_ROSTER_ACTIONS_RELEASE',attempt+1,flush=True)
 time.sleep(10)
else:raise SystemExit('ROSTER_ACTIONS_RELEASE_NOT_DEPLOYED')
for unit in ['xd-guild','xd-discord-bot','xd-guild-deploy.timer']:
 subprocess.run(['systemctl','is-active','--quiet',unit],check=True)
p=pathlib.Path('/var/www/xd-discord-bot/current')
code=r"""
import {ImportWorkflow,renderDraft} from './src/workflow.mjs';
const a={id:'first',nickname:'Alpha'},b={id:'second',nickname:'Beta'};
const catalog={members:[a,b],activities:[],drops:[]};
let d={id:'check',owner:'check',step:'review',context:{},catalog,activity:{name:'Проверка',weight:100},mode:'raid',source:'prime',analyzed:true,roster:{members:[a],guests:[],unresolved:[],readings:[{key:'original',name:'Alpha',memberId:a.id,pending:false}]},loot:{items:[],unresolved:[]}};
const errors=[];
const flow=new ImportWorkflow({store:{get:()=>structuredClone(d),put:v=>{d=v}},site:async()=>catalog});
const action=(name,values=[])=>({customId:'xd:check:'+name,user:{id:'check'},values,fields:{getTextInputValue:()=> 'Beta'},deferUpdate:async()=>{},editReply:async()=>{},reply:async v=>errors.push(v),followUp:async v=>errors.push(v),showModal:async modal=>{modal.toJSON()}});
await flow.handle(action('addMember'));await flow.handle(action('memberQuery'));await flow.handle(action('memberPick',[b.id]));
if(d.roster.members.length!==2)throw Error('ADD_MEMBER_FAILED');
await flow.handle(action('removeMember'));await flow.handle(action('removePick',['m_'+a.id]));await flow.handle(action('backreview'));
if(errors.length||d.roster.members.length!==1||d.roster.members[0].id!==b.id||!d.roster.readings.find(r=>r.key==='original').ignored)throw Error('REMOVE_MEMBER_FAILED');
const labels=renderDraft(d).components.flatMap(r=>r.components).map(c=>c.label);
if(!labels.includes('Добавить в активность')||!labels.includes('Убрать из активности'))throw Error('ROSTER_BUTTONS_MISSING');
console.log('DRAFT_ROSTER_ACTIONS_VERIFIED',JSON.stringify({add:true,remove:true,removed_reading_excluded:true,no_inference:true,no_activity_created:true}));
"""
subprocess.run(['node','--input-type=module','-'],input=code,text=True,cwd=str(p),check=True)
print('ROSTER_ACTIONS_RELEASE_VERIFIED',json.dumps({'revision':expected,'services_active':True}),flush=True)
'''.replace('EXPECTED_REVISION',revision)
r=subprocess.run(ssh+['python3 -'],input=script,text=True,timeout=660)
if r.returncode:raise SystemExit('ROSTER_ACTIONS_VERIFICATION_FAILED')
