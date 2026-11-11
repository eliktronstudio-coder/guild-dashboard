"""One-time class selection through real Next actions; isolated local fixtures."""
from pathlib import Path
exec(compile(Path(__file__).with_name('check-command-center.py').read_text().split('fixture=ThreadingHTTPServer')[0],__file__,'exec'))
selected=None;saves=[];fail=False
class ClassFixture(Fixture):
 def do_POST(self):
  global selected
  payload=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or '{}')
  if self.path.endswith('/rpc/set_own_player_class'):
   saves.append(payload)
   if fail:
    encoded=json.dumps({'code':'P0001','message':'FORBIDDEN'}).encode();self.send_response(400);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(encoded);return
   assert set(payload)=={'p_class'} and payload['p_class'] in ['Лучник','Маг','Милик','Танк']
   selected=payload['p_class']
  self.reply()
 def reply(self):
  path=urllib.parse.urlsplit(self.path).path
  if path.endswith('/memberships'):
   data=[{**member,'player_class':selected,'class_selected_at':start if selected else None}];raw=json.dumps(data).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw);return
  if path.endswith('/rpc/set_own_player_class'):
   self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b'null');return
  super().reply()
fixture=ThreadingHTTPServer(('127.0.0.1',0),ClassFixture);Thread(target=fixture.serve_forever,daemon=True).start()
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
origin=f'http://127.0.0.1:{port}';env={**os.environ,'NEXT_PUBLIC_SUPABASE_URL':f'http://127.0.0.1:{fixture.server_port}','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':'fixture-key','APP_ORIGIN':origin,'AUTH_EMAIL_ENABLED':'true'}
access=b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':USER,'aud':'authenticated','role':'authenticated','exp':int(now)+3600})+'.c2lnbmF0dXJl'
cookie='base64-'+b64({'access_token':access,'refresh_token':'fixture-refresh','token_type':'bearer','expires_at':int(now)+3600,'user':{'id':USER,'aud':'authenticated','role':'authenticated','email':'fixture@example.test'}})
artifacts=Path('/workspace/xd-player-class-artifacts');artifacts.mkdir(exist_ok=True)
with tempfile.TemporaryFile() as log:
 server=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',str(port)],cwd=ROOT,env=env,stdout=log,stderr=log)
 try:
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox']);context=browser.new_context(locale='ru-RU');context.add_cookies([{'name':'sb-127-auth-token','value':cookie,'url':origin}]);page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   for i in range(100):
    try:page.goto(origin+'/login');break
    except Exception:time.sleep(.2)
   page.goto(origin+'/login?mode=register',wait_until='networkidle');field=page.get_by_role('combobox',name='Класс игрока',exact=True);expect(field).to_have_attribute('required','');assert field.locator('option:not([disabled])').all_text_contents()==['Лучник','Маг','Милик','Танк']
   for width in [390,1440]:
    selected=None;saves.clear();page.set_viewport_size({'width':width,'height':1000});page.goto(origin+'/events',wait_until='networkidle');dialog=page.get_by_role('dialog',name='Выберите свой класс');expect(dialog).to_be_visible();expect(dialog.get_by_role('radio')).to_have_count(4)
    page.keyboard.press('Escape');expect(dialog).to_be_visible()
    dialog.get_by_role('button',name='Сохранить класс').click();assert not saves
    dialog.get_by_role('radio',name='Милик',exact=True).check();fail=True;dialog.get_by_role('button',name='Сохранить класс').click();expect(dialog.get_by_role('alert')).to_contain_text('Недостаточно прав');expect(dialog).to_be_visible();assert selected is None
    assert dialog.locator('input:checked').count()==1;fail=False;page.screenshot(path=str(artifacts/f'class-prompt-{width}.png'));dialog.get_by_role('button',name='Сохранить класс').click();expect(dialog).to_have_count(0);assert selected=='Милик'
    page.reload(wait_until='networkidle');expect(page.get_by_role('dialog')).to_have_count(0);page.goto(origin+'/treasury',wait_until='networkidle');expect(page.get_by_role('dialog')).to_have_count(0)
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
   # A fresh browser session still sees the server-side selection, not a local flag.
   other=browser.new_context(locale='ru-RU');other.add_cookies([{'name':'sb-127-auth-token','value':cookie,'url':origin}]);other_page=other.new_page();other_page.goto(origin+'/events',wait_until='networkidle');expect(other_page.get_by_role('dialog')).to_have_count(0)
   assert not errors,errors;browser.close();print('PASS: required registration class; mandatory responsive legacy prompt; Escape and empty-submit protection; errors remain retryable; successful save dismisses once across routes, reloads and fresh browser sessions')
 finally:server.terminate();server.wait(timeout=15);fixture.shutdown()
