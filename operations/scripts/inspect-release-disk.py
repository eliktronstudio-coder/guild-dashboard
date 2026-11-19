import os,subprocess
ssh=['ssh','-i',os.path.expanduser('~/.ssh/xd_operations'),'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=20','root@200.165.236.194']
script=r'''
import pathlib,subprocess,json
print(subprocess.check_output(['df','-h','/var/www'],text=True),flush=True)
for path in ['/var/www/xd-guild-releases','/var/www/xd-discord-releases','/root/.npm']:
 print('DIRECTORY_SIZE',subprocess.check_output(['du','-sh',path],text=True).strip(),flush=True)
web=pathlib.Path(subprocess.check_output(['systemctl','show','xd-guild','--property=WorkingDirectory','--value'],text=True).strip()).resolve()
bot=pathlib.Path('/var/www/xd-discord-bot/current').resolve()
print('ACTIVE_PATHS',json.dumps({'web':str(web),'bot':str(bot)}),flush=True)
for root,active in [(pathlib.Path('/var/www/xd-guild-releases'),web),(pathlib.Path('/var/www/xd-discord-releases'),bot)]:
 dirs=sorted([p for p in root.iterdir() if p.is_dir() and not p.is_symlink()],key=lambda p:p.stat().st_mtime,reverse=True)
 current=next(p for p in dirs if p==active or p in active.parents)
 index=dirs.index(current)
 keep=set(dirs[:3])|set(dirs[index:index+3])|{current}
 remove=[p for p in dirs if p not in keep]
 print('SAFE_PRUNE_PREVIEW',json.dumps({'root':str(root),'total':len(dirs),'keep':[p.name for p in keep],'remove_count':len(remove)}),flush=True)
'''
r=subprocess.run(ssh+['python3 -'],input=script,text=True,timeout=120)
if r.returncode:raise SystemExit('DISK_INSPECTION_FAILED')
