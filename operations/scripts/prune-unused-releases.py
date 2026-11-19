"""Remove only old generated releases, preserving active paths and rollback versions."""
import os,subprocess
ssh=['ssh','-i',os.path.expanduser('~/.ssh/xd_operations'),'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=20','root@200.165.236.194']
script=r'''
import pathlib,subprocess,json,shutil,fcntl,time,os
before=shutil.disk_usage('/var/www').free
active_timer=subprocess.run(['systemctl','is-active','--quiet','xd-guild-deploy.timer']).returncode==0
subprocess.run(['systemctl','stop','xd-guild-deploy.timer'],check=True)
try:
 with open('/var/lib/xd-guild-deploy/lock','a') as lock:
  deadline=time.monotonic()+45
  while True:
   try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);break
   except BlockingIOError:
    if time.monotonic()>deadline:raise RuntimeError('DEPLOY_LOCK_BUSY')
    time.sleep(1)
  web=pathlib.Path(subprocess.check_output(['systemctl','show','xd-guild','--property=WorkingDirectory','--value'],text=True).strip()).resolve()
  bot=pathlib.Path('/var/www/xd-discord-bot/current').resolve()
  protected=[web,bot,pathlib.Path('/var/lib/xd-discord-bot'),pathlib.Path('/etc/xd-discord-bot.env')]
  for name,active in [('/var/www/xd-guild-releases',web),('/var/www/xd-discord-releases',bot)]:
   root=pathlib.Path(name);assert root.resolve()==root
   dirs=sorted([p for p in root.iterdir() if p.is_dir() and not p.is_symlink()],key=lambda p:p.stat().st_mtime,reverse=True)
   current=next(p for p in dirs if p==active or p in active.parents)
   index=dirs.index(current);keep=set(dirs[:3])|set(dirs[index:index+3])|{current}
   remove=[p for p in dirs if p not in keep]
   for path in remove:
    assert path.resolve().parent==root and not path.is_symlink()
    assert all(path!=q and path not in q.parents for q in protected)
    shutil.rmtree(path)
   print('OLD_GENERATED_RELEASES_REMOVED',json.dumps({'root':name,'removed':len(remove),'retained':[p.name for p in keep]}),flush=True)
  assert web.is_dir() and bot.is_dir()
  after=shutil.disk_usage('/var/www').free
  print('DISK_SPACE_RECOVERED',json.dumps({'freed_bytes':after-before,'available_bytes':after,'live_paths_preserved':True,'bot_state_preserved':pathlib.Path('/var/lib/xd-discord-bot/drafts.sqlite').exists()}),flush=True)
finally:
 if active_timer:subprocess.run(['systemctl','start','xd-guild-deploy.timer'],check=True)
subprocess.run(['systemctl','reset-failed','xd-guild-deploy.service'],check=True)
subprocess.run(['systemctl','start','--no-block','xd-guild-deploy.service'],check=True)
'''
p=subprocess.run(ssh+['python3 -'],input=script,text=True,timeout=360)
if p.returncode:raise SystemExit('RELEASE_PRUNE_FAILED')
