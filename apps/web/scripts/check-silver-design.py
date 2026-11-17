"""Shared identity smoke test against isolated Auth/DB fixtures, no production writes."""
from pathlib import Path
exec(compile(Path(__file__).with_name('check-command-center.py').read_text().split('fixture=ThreadingHTTPServer')[0],__file__,'exec'))
class SilverFixture(Fixture):
 def do_HEAD(self):
  self.send_response(200);self.send_header('Content-Range','*/0');self.end_headers()
fixture=ThreadingHTTPServer(('127.0.0.1',0),SilverFixture);Thread(target=fixture.serve_forever,daemon=True).start()
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
origin=f'http://127.0.0.1:{port}';env={**os.environ,'NEXT_PUBLIC_SUPABASE_URL':f'http://127.0.0.1:{fixture.server_port}','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':'fixture-key','APP_ORIGIN':origin}
access=b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':USER,'aud':'authenticated','role':'authenticated','exp':int(now)+3600})+'.c2lnbmF0dXJl';cookie='base64-'+b64({'access_token':access,'refresh_token':'fixture-refresh','token_type':'bearer','expires_at':int(now)+3600,'user':{'id':USER,'aud':'authenticated','role':'authenticated','email':'fixture@example.test'}})
artifacts=Path('/workspace/guild-dashboard/.impeccable/review/silver');artifacts.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryFile() as log:
 server=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',str(port)],cwd=ROOT,env=env,stdout=log,stderr=log)
 try:
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox']);context=browser.new_context(locale='ru-RU',reduced_motion='reduce');context.add_cookies([{'name':'sb-127-auth-token','value':cookie,'url':origin}]);page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   for i in range(100):
    try:page.goto(origin+'/login');break
    except Exception:time.sleep(.2)
   for theme in ['dark','light']:
    page.evaluate("theme=>{document.documentElement.dataset.theme=theme;localStorage.setItem('xd-theme',theme)}",theme)
    for width in [390,1440]:
     page.set_viewport_size({'width':width,'height':1000})
     for path in ['/dashboard','/statistics','/events','/members','/treasury','/payments','/payments/salary','/events/archive','/account','/admin/drops','/admin/activity-banners']:
      response=page.goto(origin+path,wait_until='networkidle');assert response and response.status==200,(path,response.status if response else None)
      assert '/login' not in page.url and '/setup' not in page.url,(path,page.url)
      assert not [text for text in page.get_by_role('alert').all_text_contents() if text.strip()],(path,page.get_by_role('alert').all_text_contents())
      assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),(theme,width,path,'overflow')
      seal=page.locator('.guild-seal').first
      if width==1440:assert seal.evaluate('(e)=>e.complete&&e.naturalWidth>0'),path
      if path in ['/dashboard','/members','/treasury','/payments/salary','/events','/events/archive']:
       page.screenshot(path=str(artifacts/(theme+'-'+path.strip('/').replace('/','-')+'-'+str(width)+'.png')),full_page=True)
       page.screenshot(path=str(artifacts/('viewport-'+theme+'-'+path.strip('/').replace('/','-')+'-'+str(width)+'.png')))
      if path=='/dashboard' and width==390:
       page.get_by_role('button',name='Открыть меню').click();expect(page.get_by_role('link',name='Главная',exact=True)).to_be_visible();page.keyboard.press('Escape');expect(page.get_by_role('button',name='Открыть меню')).to_be_visible()
   context.clear_cookies()
   for theme in ['dark','light']:
    page.evaluate("theme=>{document.documentElement.dataset.theme=theme;localStorage.setItem('xd-theme',theme)}",theme)
    for width in [390,1440]:
     page.set_viewport_size({'width':width,'height':1000});page.goto(origin+'/login',wait_until='networkidle');page.screenshot(path=str(artifacts/f'{theme}-login-{width}.png'),full_page=True)
     page.screenshot(path=str(artifacts/f'viewport-{theme}-login-{width}.png'))
     assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),('login',width)
   assert not errors,errors;browser.close()
  print('PASS: shared silver identity across 11 staff routes, both themes, 390/1440px, responsive menu, emblem load and public login; isolated fixtures only')
 finally:server.terminate();server.wait(timeout=15);fixture.shutdown()
