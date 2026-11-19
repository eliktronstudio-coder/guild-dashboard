import subprocess,json,pathlib,os,sqlite3,datetime,zoneinfo,collections,re
unit='xd-discord-bot.service'
pid=subprocess.check_output(['systemctl','show',unit,'--property=MainPID','--value'],text=True).strip()
assert pid.isdigit() and int(pid)>1
pairs=dict(x.split('=',1) for x in pathlib.Path('/proc/'+pid+'/environ').read_bytes().decode().split('\0') if '=' in x)
wd=subprocess.check_output(['systemctl','show',unit,'--property=WorkingDirectory','--value'],text=True).strip()
print('BOT_SERVICE',subprocess.check_output(['systemctl','show',unit,'--property=ActiveState,SubState,NRestarts,EnvironmentFiles'],text=True).strip(),flush=True)
print('BOT_CONFIG',json.dumps({k:pairs.get(k) for k in ['OPENAI_MODEL','OPENAI_DAILY_LIMIT','OPENAI_CONCURRENCY','OPENAI_MONTHLY_BUDGET_USD','OPENAI_TIMEOUT_MS','VISION_SERVICE_URL']}),flush=True)
script=r'''
const out=(k,v)=>console.log(k,JSON.stringify(v));
async function get(url,headers={}) {try {const r=await fetch(url,{headers,signal:AbortSignal.timeout(150000),redirect:'error'});let d;try{d=await r.json()}catch{}return {status:r.status,data:d};}catch{return {status:0};}}
const origin=process.env.XD_SITE_ORIGIN; if(origin!=='https://xd-guild.ru') throw Error('ORIGIN');
const auth={Authorization:'Bearer '+process.env.DISCORD_IMPORT_SECRET};
const rt=await get(origin+'/api/discord/runtime',auth);out('SITE_RUNTIME',{status:rt.status,enabled:rt.data?.enabled});
if(rt.status===200&&rt.data?.enabled){
const c=rt.data,h={Authorization:'Bot '+c.token};
const me=await get('https://discord.com/api/v10/users/@me',h);out('DISCORD_TOKEN',{status:me.status,id:me.data?.id});
const app=await get('https://discord.com/api/v10/oauth2/applications/@me',h);out('DISCORD_APPLICATION',{status:app.status,message_content_configured:app.data?Boolean(app.data.flags&((1<<18)|(1<<19))):null});
const ch=await get('https://discord.com/api/v10/channels/'+c.channel,h);out('DISCORD_CHANNEL',{status:ch.status,id:c.channel,type:ch.data?.type,same_server:ch.data?.guild_id===c.server});
const cmds=await get('https://discord.com/api/v10/applications/'+me.data?.id+'/guilds/'+c.server+'/commands',h);out('DISCORD_COMMANDS',{status:cmds.status,names:Array.isArray(cmds.data)?cmds.data.map(x=>x.name):[]});
const r=await fetch(origin+'/api/discord/context',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({context:{server:c.server,channel:c.channel,user:me.data?.id}}),signal:AbortSignal.timeout(45000)});let d;try{d=await r.json()}catch{}out('SITE_CONTEXT',{status:r.status,error:d?.error,keys:d?Object.keys(d):[],counts:d?Object.fromEntries(Object.entries(d).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,v.length])):{}});
}
if(process.env.VISION_SERVICE_URL){const base=process.env.VISION_SERVICE_URL.replace(/\/$/,'');const health=await get(base+'/health');out('VISION_HEALTH',{status:health.status,capabilities:health.data?.capabilities});const ready=await get(base+'/ready',{Authorization:'Bearer '+process.env.VISION_SERVICE_SECRET});out('VISION_READINESS',{status:ready.status,ready:ready.data?.ready,model:ready.data?.model,error:ready.data?.error?.code});}
'''
p=subprocess.run(['node','--input-type=module','-e',script],cwd=wd,env=pairs,text=True,capture_output=True,timeout=220)
print(p.stdout,flush=True)
if p.returncode: print('NODE_AUDIT_INCOMPLETE',flush=True)
state=pathlib.Path(pairs.get('XD_DISCORD_STATE','/var/lib/xd-discord-bot'))/'drafts.sqlite'
con=sqlite3.connect('file:'+str(state)+'?mode=ro',uri=True)
now=datetime.datetime.now(zoneinfo.ZoneInfo(pairs.get('OPENAI_BUDGET_TIMEZONE','Asia/Yekaterinburg')));day=now.strftime('%Y-%m-%d');month=day[:7]
print('VISION_USAGE_TODAY',json.dumps(con.execute('select status,coalesce(error,\'\'),count(*),sum(cost_micros),sum(input_tokens),sum(output_tokens) from vision_usage where day=? group by status,error',(day,)).fetchall()),flush=True)
print('VISION_USAGE_MONTH',json.dumps(con.execute('select count(*),coalesce(sum(cost_micros),0) from vision_usage where month=?',(month,)).fetchone()),flush=True)
print('VISION_RECENT_ERRORS',json.dumps(con.execute("select error,count(*) from vision_usage where error is not null group by error").fetchall()),flush=True)
con.close()
logs=subprocess.check_output(['journalctl','-u',unit,'--since','24 hours ago','--no-pager','-o','cat'],text=True)
labels=['Discord bot connected','Waiting for site configuration or connectivity','Discord login unavailable','Cannot reply in configured activity channel','Discord command registration unavailable']
print('BOT_LOG_COUNTS_24H',json.dumps({k:logs.count(k) for k in labels}),flush=True)
print('TESSERACT',subprocess.run(['tesseract','--list-langs'],text=True,capture_output=True).stdout.strip(),flush=True)
