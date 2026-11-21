"""Deploy the existing free GPT vision service only; no env edits or inference."""
import os,json,re,time,urllib.request,urllib.error,urllib.parse
TOKEN=os.environ.get('RENDER_API_KEY','');REV=os.environ.get('XD_EXPECTED_VISION_REVISION','')
if not TOKEN:raise SystemExit('RENDER_API_KEY_NOT_CONFIGURED')
if not re.fullmatch('[a-f0-9]{40}',REV):raise SystemExit('EXPECTED_REVISION_MISSING')
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
http=urllib.request.build_opener(NoRedirect)
def api(path,method='GET',body=None):
 req=urllib.request.Request('https://api.render.com/v1'+path,data=json.dumps(body).encode() if body is not None else None,headers={'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'},method=method)
 try:
  with http.open(req,timeout=45) as r:return json.load(r)
 except urllib.error.HTTPError as e:raise SystemExit('RENDER_API_HTTP_'+str(e.code))
rows=api('/services?'+urllib.parse.urlencode({'name':'xd-gpt-vision','limit':20}))
found=[r['service'] for r in rows if r.get('service',{}).get('name')=='xd-gpt-vision']
if len(found)!=1:raise SystemExit('GPT_SERVICE_NOT_UNIQUE')
service=found[0];details=service.get('serviceDetails',{})
if service.get('repo','').rstrip('/')!='https://github.com/eliktronstudio-coder/guild-dashboard' or service.get('branch')!='codex/xd-foundation-20261031' or details.get('plan')!='free' or details.get('region')!='oregon':raise SystemExit('GPT_SERVICE_CONFIGURATION_DIFFERS')
service_id=service['id']
deploy=api('/services/'+service_id+'/deploys','POST',{'commitId':REV,'clearCache':'do_not_clear'})
deploy_id=deploy.get('id')
if not deploy_id:raise SystemExit('DEPLOY_ID_MISSING')
print('EXISTING_FREE_GPT_SERVICE_DEPLOY_STARTED',flush=True)
last=None
for attempt in range(66):
 deploy=api('/services/'+service_id+'/deploys/'+deploy_id);status=deploy.get('status')
 if status!=last:print('RENDER_DEPLOY_STATUS',status,flush=True);last=status
 if status=='live':break
 if status in ['build_failed','update_failed','pre_deploy_failed','canceled','deactivated']:raise SystemExit('RENDER_DEPLOY_FAILED')
 time.sleep(10)
else:raise SystemExit('RENDER_DEPLOY_TIMEOUT')
if deploy.get('commit',{}).get('id')!=REV:raise SystemExit('UNEXPECTED_RENDER_REVISION')
service=api('/services/'+service_id);details=service['serviceDetails']
if details.get('plan')!='free' or details.get('region')!='oregon':raise SystemExit('COMPUTE_PLAN_CHANGED')
url=details['url'].rstrip('/')
if not re.fullmatch(r'https://[a-z0-9-]+\.onrender\.com',url):raise SystemExit('SERVICE_URL_INVALID')
for attempt in range(12):
 try:
  with http.open(url+'/health',timeout=30) as r:health=json.load(r)
  if 'loot-vision-v1' in health.get('capabilities',[]) and 'gpt-only' in health.get('capabilities',[]):break
 except (urllib.error.URLError,TimeoutError):pass
 time.sleep(5)
else:raise SystemExit('GPT_ONLY_CAPABILITY_NOT_READY')
print('GPT_ONLY_RENDER_READY_NO_INFERENCE',json.dumps({'revision':REV,'free_plan':True,'env_unchanged':True,'paid_tests':0}),flush=True)
