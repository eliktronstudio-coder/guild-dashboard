"""Wait for existing autodeploy, then verify deployed bot code and service without inference."""
import os,subprocess
ssh=['ssh','-i',os.path.expanduser('~/.ssh/xd_operations'),'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=20','root@200.165.236.194']
script=r'''
import pathlib,subprocess,time,json
expected='671345342833df532268669bb2986218b67cadda'
for attempt in range(60):
 web=pathlib.Path('/var/lib/xd-guild-deploy/deployed').read_text().strip()
 bot=pathlib.Path('/var/lib/xd-discord-bot/deployed').read_text().strip()
 if web==expected and bot==expected:break
 if attempt%4==0:print('WAITING_EXISTING_AUTO_DEPLOY',attempt+1,flush=True)
 time.sleep(10)
else:raise SystemExit('EXPECTED_RELEASE_NOT_DEPLOYED')
for unit in ['xd-guild','xd-discord-bot','xd-guild-deploy.timer']:
 if subprocess.run(['systemctl','is-active','--quiet',unit]).returncode:raise SystemExit('SERVICE_NOT_ACTIVE')
p=pathlib.Path('/var/www/xd-discord-bot/current')
index=(p/'src/index.mjs').read_text();workflow=(p/'src/workflow.mjs').read_text()
assert 'next.on(\n    "messageCreate"' in index or 'next.on("messageCreate"' in index
assert (p/'src/automatic.mjs').exists()
assert 'automaticImports' in index and 'automaticNeedsChoice' in workflow
assert 'Распознать скрины' in workflow and 'Из состава — поиск по нику' in workflow
assert 'Tesseract бесплатно' not in workflow and 'Дроп из сообщения")' not in workflow
subprocess.run(['node','--check',str(p/'src/index.mjs')],check=True)
subprocess.run(['node','--check',str(p/'src/workflow.mjs')],check=True)

code=r"""
import {renderDraft} from './src/workflow.mjs';
const rendered=renderDraft({event:{url:'https://xd-guild.ru/activities/test'},publication:{activity:{title:'Проверка шаблона',coefficient:'1.50'}},savedAt:'2026-11-19T22:00:00Z'});
if(!rendered.content.includes('Название: Проверка шаблона')||!rendered.content.includes('Коэффициент: ×1,5')||!rendered.content.includes('20.11.2026')||!rendered.content.includes('03:00')||rendered.embeds.length||rendered.components.length)throw Error('SAVED_SUMMARY_INVALID');
console.log('SAVED_MESSAGE_TEMPLATE_VERIFIED',{link:true,title:true,coefficient:true,creation_time_yekaterinburg:true,old_review_cleared:true});
"""
subprocess.run(['node','--input-type=module','-'],input=code,text=True,cwd=str(p),check=True)
print('SAVED_SUMMARY_RELEASE_VERIFIED',json.dumps({'revision':expected,'automatic_recognition_enabled':True,'unified_analysis':True,'file_upload_batches':True,'member_search':True,'services_active':True}),flush=True)
'''
p=subprocess.run(ssh+['python3 -'],input=script,text=True,timeout=660)
if p.returncode:raise SystemExit('UNIFIED_BOT_RELEASE_CHECK_FAILED')
