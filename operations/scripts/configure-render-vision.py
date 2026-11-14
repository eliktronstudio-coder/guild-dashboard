"""Provision only the XD Free vision service, then cut over the existing worker.
No inference requests, no secret output, no changes to the legacy Claude service.
"""
import json, os, pathlib, re, secrets, subprocess, sys, time, urllib.request, urllib.error, urllib.parse

API='https://api.render.com/v1'
LEGACY='srv-da6shquk1f9s73ehtm8g'
NAME='xd-gpt-vision'
REPO='https://github.com/eliktronstudio-coder/guild-dashboard'
BRANCH='codex/xd-foundation-20261031'
TOKEN=os.environ.get('RENDER_API_KEY','')
REV=os.environ.get('XD_EXPECTED_VISION_REVISION','')
if not TOKEN: raise SystemExit('RENDER_API_KEY_NOT_CONFIGURED')
if not re.fullmatch('[0-9a-f]{40}',REV): raise SystemExit('EXPECTED_RELEASE_MISSING')
SSH=['ssh','-i',os.path.expanduser('~/.ssh/xd_operations'),'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=20','root@200.165.236.194']
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs): return None
HTTP=urllib.request.build_opener(NoRedirect)
def api(path,method='GET',body=None):
 req=urllib.request.Request(API+path,data=json.dumps(body).encode() if body is not None else None,headers={'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'},method=method)
 try:
  with HTTP.open(req,timeout=45) as r:
   data=r.read();return json.loads(data) if data else None
 except urllib.error.HTTPError as e:
  print('RENDER_API_HTTP_ERROR',e.code,flush=True);raise SystemExit(1)
def remote(script,payload=None):
 # stdin only; credentials never appear in command arguments or output logs.
 if payload is None:
  r=subprocess.run(SSH+['python3 -'],input=script,text=True,capture_output=True,timeout=60)
 else:
  encoded=__import__('base64').b64encode(script.encode()).decode()
  r=subprocess.run(SSH+["python3 -c \"import base64;exec(base64.b64decode('"+encoded+"'))\""],input=json.dumps(payload),text=True,capture_output=True,timeout=60)
 if r.returncode: raise SystemExit('WORKER_CONFIGURATION_COMMAND_FAILED')
 try:return json.loads(r.stdout)
 except:raise SystemExit('WORKER_CONFIGURATION_RESPONSE_INVALID')
source=remote('''import pathlib,json,re,hashlib,subprocess
p=pathlib.Path('/etc/xd-discord-bot.env');text=p.read_text();pairs={}
for line in text.splitlines():
 m=re.fullmatch(r'([A-Z0-9_]+)=(.*)',line)
 if m:
  value=m[2].strip()
  if len(value)>=2 and value[0]==value[-1] and value[0] in "\\\"'":value=value[1:-1]
  pairs[m[1]]=value
root=pathlib.Path('/var/www/xd-discord-bot/current')
assert (root/'src/vision-remote.mjs').exists()
print(json.dumps({'key':pairs.get('OPENAI_API_KEY'),'secret':pairs.get('VISION_SERVICE_SECRET'),'envHash':hashlib.sha256(text.encode()).hexdigest(),'revision':pathlib.Path('/var/lib/xd-discord-bot/deployed').read_text().strip()}))
''')
if source['revision']!=REV: raise SystemExit('WORKER_RELEASE_NOT_READY')
secret=source.get('secret') or secrets.token_urlsafe(48)
if len(secret)<32: raise SystemExit('INVALID_WORKER_SERVICE_SECRET')
legacy=api('/services/'+LEGACY)
if legacy.get('name')!='guild-vision-proxy' or legacy.get('type')!='web_service':raise SystemExit('UNEXPECTED_LEGACY_SERVICE')
owner=legacy['ownerId'];before_legacy=(legacy.get('repo'),legacy.get('branch'),legacy.get('updatedAt'))
rows=api('/services?'+urllib.parse.urlencode({'ownerId':owner,'name':NAME,'limit':20}))
found=[r['service'] for r in rows if r.get('service',{}).get('name')==NAME and r['service'].get('ownerId')==owner]
if len(found)>1:raise SystemExit('AMBIGUOUS_VISION_SERVICE')
env=[{'key':'NODE_VERSION','value':'24'},{'key':'OPENAI_MODEL','value':'gpt-5.4-mini'},{'key':'VISION_SERVICE_SECRET','value':secret}]
if source.get('key'):env.append({'key':'OPENAI_API_KEY','value':source['key']})
created=False
if found:
 service=found[0];details=service.get('serviceDetails',{})
 if service.get('repo','').rstrip('/')!=REPO or service.get('branch')!=BRANCH or service.get('type')!='web_service' or details.get('plan')!='free' or details.get('region')!='oregon':raise SystemExit('EXISTING_SERVICE_CONFIGURATION_DIFFERS')
 service=api('/services/'+service['id'],'PATCH',{'autoDeployTrigger':'off','rootDir':'','serviceDetails':{'healthCheckPath':'/health','envSpecificDetails':{'buildCommand':'npm ci --prefix apps/vision-service','startCommand':'node apps/vision-service/src/index.mjs'}}})
 for variable in env:api('/services/'+service['id']+'/env-vars/'+variable['key'],'PUT',{'value':variable['value']})
else:
 if not source.get('key'):raise SystemExit('OPENAI_KEY_NOT_AVAILABLE_FOR_INITIAL_RENDER_SETUP')
 data=api('/services','POST',{'type':'web_service','name':NAME,'ownerId':owner,'repo':REPO,'branch':BRANCH,'rootDir':'','autoDeployTrigger':'off','envVars':env,'serviceDetails':{'runtime':'node','plan':'free','region':'oregon','numInstances':1,'healthCheckPath':'/health','envSpecificDetails':{'buildCommand':'npm ci --prefix apps/vision-service','startCommand':'node apps/vision-service/src/index.mjs'}}})
 service=data.get('service',data);created=True
service_id=service['id']
if not re.fullmatch('srv-[a-z0-9]+',service_id):raise SystemExit('INVALID_SERVICE_ID')
if created:
 deploy_id=data.get('deployId')
 if deploy_id:
  deploy=api('/services/'+service_id+'/deploys/'+deploy_id)
  if deploy.get('commit',{}).get('id')!=REV:deploy_id=None
else:deploy_id=None
if not deploy_id:
 deploy=api('/services/'+service_id+'/deploys','POST',{'commitId':REV,'clearCache':'do_not_clear'})
 if not deploy or not deploy.get('id'):raise SystemExit('DEPLOY_ID_NOT_RETURNED')
 deploy_id=deploy['id']
if not re.fullmatch('dep-[a-z0-9]+',deploy_id):raise SystemExit('INVALID_DEPLOY_ID')
print('RENDER_VISION_FREE_DEPLOY_STARTED',flush=True)
deadline=time.monotonic()+660;last=None
while time.monotonic()<deadline:
 deploy=api('/services/'+service_id+'/deploys/'+deploy_id);status=deploy.get('status')
 if status!=last:print('RENDER_VISION_DEPLOY_STATUS',status,flush=True);last=status
 if status=='live':break
 if status in ['build_failed','update_failed','pre_deploy_failed','canceled','deactivated']:raise SystemExit('RENDER_VISION_DEPLOY_FAILED')
 time.sleep(10)
else:raise SystemExit('RENDER_VISION_DEPLOY_TIMED_OUT')
if deploy.get('commit',{}).get('id')!=REV:raise SystemExit('UNEXPECTED_RENDER_REVISION')
service=api('/services/'+service_id);details=service['serviceDetails']
if details['plan']!='free' or details['region']!='oregon':raise SystemExit('RENDER_COMPUTE_PLAN_CHANGED')
url=details['url'].rstrip('/');parsed=urllib.parse.urlsplit(url)
if parsed.scheme!='https' or not parsed.hostname.endswith('.onrender.com') or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path:raise SystemExit('INVALID_RENDER_SERVICE_URL')
try:
 req=urllib.request.Request(url+'/ready',headers={'Authorization':'Bearer '+secret})
 with HTTP.open(req,timeout=150) as r:ready=json.load(r)
except urllib.error.HTTPError as e:
 # The authenticated service returns sanitized codes only, never API keys or SDK messages.
 try:code=json.load(e).get('error',{}).get('code','unknown')
 except:code='unknown'
 if code not in ['unsupported_country_region_territory','insufficient_quota','billing_hard_limit_reached']:code='unknown'
 print('RENDER_MODEL_METADATA_CHECK_FAILED',e.code,code,flush=True);raise SystemExit(1)
if ready.get('ready') is not True or ready.get('model')!='gpt-5.4-mini' or ready.get('protocol')!=1:raise SystemExit('VISION_SERVICE_NOT_READY')
print('RENDER_OPENAI_MODEL_METADATA_READY_NO_INFERENCE',flush=True)
# Change only our dedicated variables, after free readiness and with a concurrent-edit guard.
result=remote('''import sys,json,pathlib,re,hashlib,os,tempfile,subprocess
v=json.load(sys.stdin);p=pathlib.Path('/etc/xd-discord-bot.env');text=p.read_text()
assert hashlib.sha256(text.encode()).hexdigest()==v['envHash']
remove={'OPENAI_API_KEY','VISION_SERVICE_URL','VISION_SERVICE_SECRET','OPENAI_TIMEOUT_MS'}
lines=[line for line in text.splitlines() if not any(re.match(r'^'+key+r'=',line) for key in remove)]
lines.extend(['VISION_SERVICE_URL='+v['url'],'VISION_SERVICE_SECRET='+v['secret'],'OPENAI_TIMEOUT_MS=120000'])
new='\\n'.join(lines)+'\\n'
fd,tmp=tempfile.mkstemp(prefix='.xd-discord-env-',dir='/etc')
try:
 os.fchmod(fd,0o600)
 with os.fdopen(fd,'w') as f:f.write(new)
 os.replace(tmp,p)
except:
 if os.path.exists(tmp):os.unlink(tmp)
 raise
subprocess.run(['systemctl','restart','xd-discord-bot.service'],check=True,capture_output=True)
print(json.dumps({'updated':True}))
''',{'envHash':source['envHash'],'url':url,'secret':secret})
if not result.get('updated'):raise SystemExit('WORKER_CUTOVER_FAILED')
time.sleep(3)
check=remote('''import pathlib,subprocess,json,os
assert subprocess.run(['systemctl','is-active','--quiet','xd-discord-bot.service']).returncode==0
pid=subprocess.check_output(['systemctl','show','xd-discord-bot.service','--property=MainPID','--value'],text=True).strip()
pairs=dict(x.split('=',1) for x in pathlib.Path('/proc/'+pid+'/environ').read_text().split('\\0') if '=' in x)
assert not pairs.get('OPENAI_API_KEY') and pairs.get('VISION_SERVICE_URL') and len(pairs.get('VISION_SERVICE_SECRET',''))>=32
assert oct(pathlib.Path('/etc/xd-discord-bot.env').stat().st_mode&0o777)=='0o600'
print(json.dumps({'remote':True,'workerOpenAIKey':False}))
''')
if not check.get('remote') or check.get('workerOpenAIKey'):raise SystemExit('WORKER_REMOTE_CONFIGURATION_INVALID')
after=api('/services/'+LEGACY)
if (after.get('repo'),after.get('branch'),after.get('updatedAt'))!=before_legacy:raise SystemExit('LEGACY_SERVICE_CHANGED_DURING_SETUP')
# Future service updates follow checked commits touching only its own source/protocol.
api('/services/'+service_id,'PATCH',{'autoDeployTrigger':'checksPass','buildFilter':{'paths':['apps/vision-service/**','apps/discord-bot/src/vision-protocol.mjs','apps/discord-bot/src/vision-remote.mjs'],'ignoredPaths':[]}})
print('LEGACY_CLAUDE_SERVICE_UNCHANGED',flush=True)
print('VISION_RENDER_CUTOVER_COMPLETE',json.dumps({'url':url,'plan':'free','region':'oregon','workerOpenAIKey':False,'paidInferenceTests':0}),flush=True)
