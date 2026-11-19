"""Read-only diagnostics of recent recognition drafts; no inference or website writes."""
import os,subprocess
ssh=['ssh','-i',os.path.expanduser('~/.ssh/xd_operations'),'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=20','root@200.165.236.194']
script=r'''
import sqlite3,json,datetime,subprocess
c=sqlite3.connect('file:/var/lib/xd-discord-bot/drafts.sqlite?mode=ro',uri=True)
for updated,payload in c.execute('select updated,payload from drafts order by updated desc limit 3'):
 d=json.loads(payload);r=d.get('roster',{});loot=d.get('loot',{});
 print('RECENT_RECOGNITION',json.dumps({'updated_utc':datetime.datetime.fromtimestamp(updated/1000,datetime.timezone.utc).isoformat(),'message':d.get('message'),'step':d.get('step'),'automatic':d.get('automaticNeedsChoice'),'analyzed':d.get('analyzed'),'images':len(d.get('attachments',[])),'detected_slots':r.get('detectedSlots'),'members':len(r.get('members',[])),'guests':len(r.get('guests',[])),'unresolved':len(r.get('unresolved',[])),'readings':[{'raw':x.get('visible'),'selected':x.get('name'),'status':x.get('status'),'pending':x.get('pending'),'engine':x.get('engine')} for x in r.get('readings',[])],'notices':d.get('recognitionNotices',[]),'loot_items':len(loot.get('items',[]))},ensure_ascii=False),flush=True)
print('LATEST_GPT_ATTEMPTS',json.dumps(c.execute('select day,status,error,input_tokens,output_tokens,cost_micros from vision_usage order by started desc limit 3').fetchall()),flush=True)
logs=subprocess.check_output(['journalctl','-u','xd-discord-bot','--since','30 minutes ago','--no-pager','-o','cat'],text=True)
print('AUTOMATIC_FAILURE_COUNT',logs.count('Automatic screenshot analysis unavailable'),flush=True)
c.close()
'''
r=subprocess.run(ssh+['python3 -'],input=script,text=True,timeout=60)
if r.returncode:raise SystemExit('READ_ONLY_DRAFT_CHECK_FAILED')
