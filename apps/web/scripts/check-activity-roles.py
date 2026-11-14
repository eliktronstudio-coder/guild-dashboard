"""Check new-role controls and the ordinary member claim entry point using isolated fixtures."""
from pathlib import Path
exec(compile(Path(__file__).with_name('check-activity-workspace.py').read_text().split('\nfixture=ThreadingHTTPServer')[0],__file__,'exec'))
role='tablemaker'
class RolesFixture(WorkspaceFixture):
 def reply(self):
  path=urllib.parse.urlsplit(self.path).path;q=urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query);p=getattr(self,'payload',{})
  if path.endswith('/rpc/has_permission'):
   allowed={'tablemaker':{'members.read','events.manage','attendance.manage','activities.loot'},'member':{'members.read','treasury.read'}}
   return self.send(role=='owner' or p.get('permission') in allowed.get(role,set()))
  if path.endswith('/memberships'):
   if q.get('user_id'):return self.send([member])
   if q.get('id',[''])[0].startswith('eq.'):return self.send([{**next((m for m in people if m['id']==q['id'][0][3:]),member),'profile_version':1,'about':'','membership_roles':[{'roles':{'code':'tablemaker','name':'Таблицмейкер'}}]}])
  if path.endswith('/attendance') and q.get('membership_id'):return self.send([])
  return super().reply()
fixture=ThreadingHTTPServer(('127.0.0.1',0),RolesFixture);Thread(target=fixture.serve_forever,daemon=True).start()
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
origin=f'http://127.0.0.1:{port}';env={**os.environ,'NEXT_PUBLIC_SUPABASE_URL':f'http://127.0.0.1:{fixture.server_port}','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':'fixture-key','APP_ORIGIN':origin}
access=b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':USER,'aud':'authenticated','role':'authenticated','exp':int(now)+3600})+'.c2lnbmF0dXJl';cookie='base64-'+b64({'access_token':access,'refresh_token':'fixture-refresh','token_type':'bearer','expires_at':int(now)+3600,'user':{'id':USER,'aud':'authenticated','role':'authenticated','email':'fixture@example.test'}})
with tempfile.TemporaryFile() as log:
 server=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',str(port)],cwd=ROOT,env=env,stdout=log,stderr=log)
 try:
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox']);context=browser.new_context(locale='ru-RU');context.add_cookies([{'name':'sb-127-auth-token','value':cookie,'url':origin}]);page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   for i in range(100):
    try:page.goto(origin+'/events');break
    except Exception:time.sleep(.2)
   for width in [390,1440]:
    page.set_viewport_size({'width':width,'height':1000});page.goto(origin+'/events/new',wait_until='networkidle');expect(page.get_by_role('heading',name='Добавить активность',exact=True)).to_be_visible();expect(page.get_by_text('Дроп (необязательно, из реестра)',exact=True)).to_be_visible();expect(page.get_by_role('link',name='Экономика',exact=True)).to_have_count(0)
    page.goto(origin+f'/events/{EVENT}',wait_until='networkidle');expect(page.get_by_role('link',name='✎ Редактировать').first).to_be_visible();expect(page.get_by_text('＋ Добавить предмет',exact=True)).to_be_visible();expect(page.get_by_text('Казна и продажи →',exact=True)).to_have_count(0)
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
   role='owner';page.goto(origin+f"/members/{people[1]['id']}",wait_until='networkidle');page.get_by_text('Управление доступом',exact=True).click();selector=page.get_by_role('combobox',name='Роль',exact=True);expect(selector.locator('option[value=guild_master]')).to_have_text('Гильд мастер');expect(selector.locator('option[value=tablemaker]')).to_have_text('Таблицмейкер')
   role='member';STAFF=False;reports[EVENT]['members']=[m['id'] for m in people[1:3]];page.goto(origin+f'/events/{EVENT}',wait_until='networkidle');expect(page.get_by_role('heading',name='Я участвовал в активности',exact=True)).to_be_visible();page.get_by_text('Подать заявку на участие',exact=True).click();expect(page.get_by_role('button',name='Отправить заявку')).to_be_visible();expect(page.get_by_role('link',name='✎ Редактировать')).to_have_count(0)
   assert not errors,errors;browser.close();print('PASS: tablemaker activity/drop controls without economy, both role options, ordinary member claim form; 390/1440px; fixtures only',flush=True)
 finally:
  server.terminate();server.wait(timeout=15);fixture.shutdown()
