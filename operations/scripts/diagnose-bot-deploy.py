import os,subprocess
ssh=['ssh','-i',os.path.expanduser('~/.ssh/xd_operations'),'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=20','root@200.165.236.194']
script=r'''
import subprocess,pathlib,re
for unit in ['xd-guild','xd-discord-bot','xd-guild-deploy','xd-guild-deploy.timer']:
 print('SERVICE',unit,subprocess.check_output(['systemctl','show',unit,'--property=ActiveState,SubState,ExecMainStatus'],text=True).strip(),flush=True)
for name in ['/var/lib/xd-guild-deploy/deployed','/var/lib/xd-discord-bot/deployed']:
 print('REVISION',name,pathlib.Path(name).read_text().strip(),flush=True)
print('CHECKOUT_HEAD',subprocess.check_output(['git','rev-parse','HEAD'],cwd='/var/www/xd-guild-command-center',text=True).strip(),flush=True)
logs=subprocess.check_output(['journalctl','-u','xd-guild-deploy','-n','160','--no-pager','-o','cat'],text=True)
for line in logs.splitlines():
 if any(w in line.lower() for w in ['error','fail','compile','building','starting','started','syntax','unexpected','not defined','not exported','passed','exit code']):
  line=re.sub(r'(sk-[A-Za-z0-9_-]+|sb_secret_[A-Za-z0-9_-]+)','[REDACTED]',line)
  print('DEPLOY_DIAGNOSTIC',line[:500],flush=True)
'''
p=subprocess.run(ssh+['python3 -'],input=script,text=True,timeout=60)
if p.returncode:raise SystemExit('DEPLOY_DIAGNOSTIC_FAILED')
