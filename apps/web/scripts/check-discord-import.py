"""Isolated production Next admin and bridge API checks; never connects Discord."""
from pathlib import Path
exec(compile(Path(__file__).with_name('check-command-center.py').read_text().split('fixture=ThreadingHTTPServer')[0],__file__,'exec'))
SECRET='fixture-discord-bridge-secret-1234567890';settings=None;bindings=[];published=[]
class DiscordFixture(Fixture):
 def send(self,data,status=200):
  raw=json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
 def do_POST(self):
  global settings
  p=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or '{}');path=urllib.parse.urlsplit(self.path).path
  if path.endswith('/rpc/save_discord_settings'):settings={'discord_guild_id':p['p_server'],'channel_id':p['p_channel'],'enabled':p['p_enabled'],'connected_at':None,'application_id':None};return self.send(None)
  if path.endswith('/rpc/save_discord_staff'):
   if p['p_remove']:bindings[:]=[b for b in bindings if b['discord_user_id']!=p['p_user']]
   else:bindings.append({'discord_user_id':p['p_user'],'membership_id':p['p_member']})
   return self.send(None)
  if path.endswith('/rpc/discord_runtime'):return self.send(None)
  if path.endswith('/rpc/discord_import_context'):return self.send({'members':[member],'activities':[],'drops':[]})
  if path.endswith('/rpc/record_discord_activity'):published.append(p);return self.send(EVENT)
  self.reply()
 def reply(self):
  path=urllib.parse.urlsplit(self.path).path
  if path.endswith('/discord_settings'):return self.send([settings] if settings else [])
  if path.endswith('/discord_staff'):return self.send(bindings)
  if path.endswith('/discord_imports'):return self.send([])
  super().reply()
fixture=ThreadingHTTPServer(('127.0.0.1',0),DiscordFixture);Thread(target=fixture.serve_forever,daemon=True).start()
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
origin=f'http://127.0.0.1:{port}';env={**os.environ,'NEXT_PUBLIC_SUPABASE_URL':f'http://127.0.0.1:{fixture.server_port}','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':'fixture-key','SUPABASE_SECRET_KEY':'fixture-service-key','APP_ORIGIN':origin,'DISCORD_IMPORT_SECRET':SECRET}
access=b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':USER,'aud':'authenticated','role':'authenticated','exp':int(now)+3600})+'.c2lnbmF0dXJl';cookie='base64-'+b64({'access_token':access,'refresh_token':'fixture-refresh','token_type':'bearer','expires_at':int(now)+3600,'user':{'id':USER,'aud':'authenticated','role':'authenticated','email':'fixture@example.test'}})
artifacts=Path('/workspace/xd-discord-artifacts');artifacts.mkdir(exist_ok=True)
with tempfile.TemporaryFile() as log:
 server=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',str(port)],cwd=ROOT,env=env,stdout=log,stderr=log)
 try:
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox']);context=browser.new_context(locale='ru-RU');context.add_cookies([{'name':'sb-127-auth-token','value':cookie,'url':origin}]);page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   for attempt in range(100):
    try:page.goto(origin+'/login');break
    except Exception:time.sleep(.2)
   for theme in ['dark','light']:
    page.evaluate("t=>{localStorage.setItem('xd-theme',t);document.documentElement.dataset.theme=t}",theme)
    for width in [360,390,768,1440]:
     page.set_viewport_size({'width':width,'height':1000});page.goto(origin+'/admin/discord',wait_until='networkidle');assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1');assert not page.locator('p[role=alert]').count();assert SECRET not in page.content()
     if theme=='dark' and width in [390,1440]:page.screenshot(path=str(artifacts/f'discord-admin-{width}.png'),full_page=True)
   page.get_by_label('ID Discord-сервера',exact=True).fill('123456789012345678');page.get_by_label('ID канала «Активность»',exact=True).fill('223456789012345678');page.get_by_role('button',name='Сохранить подключение').click();page.get_by_text('Настройки сохранены.',exact=False).wait_for();assert settings['enabled']
   assert page.get_by_text('Кто может создавать активности',exact=True).count()==1
   assert page.get_by_role('button',name='Связать сотрудника').count()==0
   assert context.request.get(origin+'/api/discord/runtime').status==401;headers={'Authorization':'Bearer '+SECRET};r=context.request.get(origin+'/api/discord/runtime',headers=headers);assert r.status==200 and r.json()=={'enabled':False}
   ctx={'server':'123456789012345678','channel':'223456789012345678','parent':None,'user':'323456789012345678'}
   assert context.request.post(origin+'/api/discord/context',data={'context':ctx}).status==401
   assert context.request.post(origin+'/api/discord/context',data={'context':{**ctx,'user':'invalid'}},headers=headers).status==400
   assert context.request.post(origin+'/api/discord/context',data={'context':ctx},headers=headers).status==200
   body={'context':ctx,'request':EVENT,'message':'423456789012345678','activity':{'title':'Левиафан','status':'completed','startsAt':start[:19],'kind':'raid','source':'prime','coefficient':'1','reward':'0','difficulty':'normal','counts':True,'confirmRoster':True,'members':[MEMBER],'guests':[],'evidence':[],'loot':[],'facts':{}}}
   r=context.request.post(origin+'/api/discord/import',data=body,headers=headers);assert r.status==200,r.text();assert published[0]['p_payload']['confirm_roster'] is True;assert published[0]['p_payload']['weight']==100
   body['activity']['coefficient']='oops';assert context.request.post(origin+'/api/discord/import',data=body,headers=headers).status==400;assert len(published)==1
   anon=browser.new_context();r=anon.request.get(origin+'/admin/discord');assert ('/login' in r.url or '/login' in r.text()) and 'fixture-service-key' not in r.text();assert not errors,errors;browser.close();print('PASS: responsive private Discord admin, channel settings without per-user binding, bridge authentication/body validation, exact publication payload and anonymous isolation; no Discord API calls',flush=True)
 finally:server.terminate();server.wait(timeout=15);fixture.shutdown()
