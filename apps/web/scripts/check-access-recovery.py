"""Request deduplication and recoverable database failure, using local fixtures only."""
from pathlib import Path
from collections import Counter
exec(compile(Path(__file__).with_name('check-command-center.py').read_text().split('fixture=ThreadingHTTPServer')[0],__file__,'exec'))
checks=Counter();unavailable=False
class AccessFixture(Fixture):
 def do_POST(self):
  payload=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or '{}')
  if self.path.endswith('/rpc/has_permission'):checks[payload['permission']]+=1
  self.reply()
 def reply(self):
  if unavailable and urllib.parse.urlsplit(self.path).path.endswith('/profiles'):
   data=json.dumps({'code':'57014','message':'fixture database unavailable'}).encode()
   self.send_response(503);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(data);return
  super().reply()
fixture=ThreadingHTTPServer(('127.0.0.1',0),AccessFixture);Thread(target=fixture.serve_forever,daemon=True).start()
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
origin=f'http://127.0.0.1:{port}';env={**os.environ,'NEXT_PUBLIC_SUPABASE_URL':f'http://127.0.0.1:{fixture.server_port}','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':'fixture-key','APP_ORIGIN':origin}
access=b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':USER,'aud':'authenticated','role':'authenticated','exp':int(now)+3600})+'.c2lnbmF0dXJl'
cookie='base64-'+b64({'access_token':access,'refresh_token':'fixture-refresh','token_type':'bearer','expires_at':int(now)+3600,'user':{'id':USER,'aud':'authenticated','role':'authenticated','email':'fixture@example.test'}})
with tempfile.TemporaryFile() as log:
 server=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',str(port)],cwd=ROOT,env=env,stdout=log,stderr=log)
 try:
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox']);context=browser.new_context(locale='ru-RU');context.add_cookies([{'name':'sb-127-auth-token','value':cookie,'url':origin}]);page=context.new_page()
   for i in range(100):
    try:page.goto(origin+'/login');break
    except Exception:time.sleep(.2)
   checks.clear();page.goto(origin+'/treasury',wait_until='networkidle')
   expect(page.get_by_role('navigation',name='Основная навигация')).to_be_visible()
   assert checks['treasury.read']==1,checks
   assert checks['treasury.allocate']==1,checks
   # Start another server request with a transient failure; the session stays.
   unavailable=True;page.goto(origin+'/treasury',wait_until='networkidle')
   expect(page.get_by_role('heading',name='Не удалось загрузить страницу')).to_be_visible()
   assert '/setup' not in page.url and '/login' not in page.url,page.url
   unavailable=False;page.get_by_role('button',name='Повторить',exact=True).click()
   expect(page.get_by_role('navigation',name='Основная навигация')).to_be_visible(timeout=15000)
   assert any(c['name']=='sb-127-auth-token' for c in context.cookies())
   page.goto(origin+'/setup?problem=database',wait_until='networkidle')
   expect(page.get_by_role('link',name='Повторить загрузку')).to_be_visible()
   expect(page.get_by_text('ПОДГОТОВКА К ЗАПУСКУ',exact=True)).to_have_count(0)
   browser.close();print('PASS: permission calls deduplicated per request; database failure preserves session and route; retry recovers; old error URL offers recovery')
 finally:server.terminate();server.wait(timeout=15);fixture.shutdown()
