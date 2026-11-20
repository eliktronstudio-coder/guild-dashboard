"""Deploy only the existing Free GPT vision service; preserve all secrets/settings."""
import os,json,re,time,urllib.request,urllib.error,urllib.parse,sys
key=os.environ.get('RENDER_API_KEY','')
if not key:raise SystemExit('RENDER_API_KEY_NOT_CONFIGURED')
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
http=urllib.request.build_opener(NoRedirect)
def api(path,method='GET',value=None):
 req=urllib.request.Request('https://api.render.com/v1'+path,data=None if value is None else json.dumps(value).encode(),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'},method=method)
 try:
  with http.open(req,timeout=45) as r:return json.load(r)
 except urllib.error.HTTPError as e:raise SystemExit('RENDER_API_HTTP_'+str(e.code))
rows=api('/services?'+urllib.parse.urlencode({'name':'xd-gpt-vision','limit':100}))
services=[r['service'] for r in rows if r.get('service',{}).get('name')=='xd-gpt-vision']
if len(services)!=1:raise SystemExit('VISION_SERVICE_NOT_UNIQUE')
s=api('/services/'+services[0]['id']);d=s.get('serviceDetails',{})
if s.get('type')!='web_service' or s.get('repo','').rstrip('/').removesuffix('.git')!='https://github.com/eliktronstudio-coder/guild-dashboard' or s.get('branch')!='codex/xd-foundation-20261031' or d.get('plan')!='free' or d.get('region')!='oregon':raise SystemExit('UNEXPECTED_RENDER_SERVICE_CONFIGURATION')
url=d['url'].rstrip('/')
if url!='https://xd-gpt-vision.onrender.com':raise SystemExit('UNEXPECTED_RENDER_SERVICE_URL')
print('EXISTING_FREE_VISION_SERVICE_VERIFIED',flush=True)
if '--preflight' in sys.argv:raise SystemExit(0)
revision=os.environ.get('XD_EXPECTED_VISION_REVISION','')
if not re.fullmatch('[a-f0-9]{40}',revision):raise SystemExit('EXPECTED_REVISION_MISSING')
rows=api('/services/'+s['id']+'/deploys?limit=10')
matching=[r['deploy'] for r in rows if r.get('deploy',{}).get('commit',{}).get('id')==revision and r['deploy'].get('status') not in ['build_failed','update_failed','pre_deploy_failed','canceled','deactivated']]
deploy=matching[0] if matching else api('/services/'+s['id']+'/deploys','POST',{'commitId':revision,'clearCache':'do_not_clear'})
if not re.fullmatch('dep-[a-z0-9]+',deploy.get('id','')):raise SystemExit('DEPLOY_ID_INVALID')
last=None;deadline=time.monotonic()+480
while time.monotonic()<deadline:
 deploy=api('/services/'+s['id']+'/deploys/'+deploy['id']);status=deploy.get('status')
 if status!=last:print('RENDER_DEPLOY_STATUS',status,flush=True);last=status
 if status=='live':break
 if status in ['build_failed','update_failed','pre_deploy_failed','canceled','deactivated']:raise SystemExit('RENDER_DEPLOY_FAILED')
 time.sleep(10)
else:raise SystemExit('RENDER_DEPLOY_TIMED_OUT')
if deploy.get('commit',{}).get('id')!=revision:raise SystemExit('RENDER_REVISION_MISMATCH')
for attempt in range(12):
 try:
  with urllib.request.urlopen(url+'/health',timeout=90) as r:health=json.load(r)
  if health.get('limits')=={'daily':None,'concurrent':2,'monthlyBudgetUSD':5}:break
 except (urllib.error.URLError,TimeoutError):pass
 time.sleep(5)
else:raise SystemExit('RENDER_UNLIMITED_HEALTH_NOT_READY')
print('RENDER_DAILY_LIMIT_REMOVED_VERIFIED',json.dumps({'revision':revision,'daily':None,'concurrent':2,'monthly_budget_usd':5,'plan':'free','secrets_unchanged':True}),flush=True)
