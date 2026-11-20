"""Real Next server actions against isolated Auth/DB fixture, no external accounts."""
from pathlib import Path
exec(compile(Path(__file__).with_name('check-command-center.py').read_text().split('fixture=ThreadingHTTPServer')[0],__file__,'exec'))
registered=False;active=False;allowed=True;creates=[];signins=[];lookups=[]
user={'id':USER,'aud':'authenticated','role':'authenticated','email':'player@example.test','email_confirmed_at':'2026-11-09T00:00:00Z','app_metadata':{'provider':'email'},'user_metadata':{},'created_at':'2026-11-09T00:00:00Z'}
def token():return b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':USER,'aud':'authenticated','role':'authenticated','session_id':'66666666-6666-4666-8666-666666666666','exp':int(time.time())+3600})+'.c2lnbmF0dXJl'
class RegistrationFixture(Fixture):
 def send(self,data,status=200):
  raw=json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
 def do_POST(self):
  global registered,active
  payload=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or '{}');path=urllib.parse.urlsplit(self.path).path
  if path=='/auth/v1/admin/users':
   creates.append(payload)
   assert self.headers.get('apikey')=='fixture-secret'
   if registered:return self.send({'message':'Email already exists','code':'email_exists'},422)
   registered=True;user['user_metadata']=payload['user_metadata'];return self.send(user)
  if path=='/auth/v1/token':
   signins.append(payload)
   if not registered or payload['email']!=user['email'] or payload['password']!='correct-password-123':return self.send({'message':'Invalid login credentials','code':'invalid_credentials'},400)
   return self.send({'access_token':token(),'refresh_token':'fixture-refresh','token_type':'bearer','expires_in':3600,'user':user})
  if path.endswith('/rpc/claim_auth_attempt'):return self.send(allowed)
  if path.endswith('/rpc/registration_login_email'):
   lookups.append(payload);assert self.headers.get('apikey')=='fixture-secret';return self.send(user['email'] if payload['p_login']=='player_xd' else None)
  if path.endswith('/rpc/complete_open_registration'):active=True;return self.send(MEMBER)
  if path.endswith('/rpc/revoke_my_sessions') or path=='/auth/v1/logout':return self.send(None)
  self.reply()
 def reply(self):
  path=urllib.parse.urlsplit(self.path).path
  if path=='/auth/v1/user':return self.send(user)
  if path.endswith('/memberships'):return self.send([member] if active else [])
  super().reply()
fixture=ThreadingHTTPServer(('127.0.0.1',0),RegistrationFixture);Thread(target=fixture.serve_forever,daemon=True).start()
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
origin=f'http://127.0.0.1:{port}';env={**os.environ,'NEXT_PUBLIC_SUPABASE_URL':f'http://127.0.0.1:{fixture.server_port}','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':'fixture-key','SUPABASE_SECRET_KEY':'fixture-secret','APP_ORIGIN':origin,'AUTH_EMAIL_ENABLED':'true','AUTH_EMAIL_DELIVERY_READY':'false'}
artifacts=Path('/workspace/xd-registration-artifacts');artifacts.mkdir(exist_ok=True)
with tempfile.TemporaryFile() as log:
 server=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',str(port)],cwd=ROOT,env=env,stdout=log,stderr=log)
 try:
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox']);context=browser.new_context(locale='ru-RU');page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   for attempt in range(100):
    try:page.goto(origin+'/login?mode=register');break
    except Exception:time.sleep(.2)
   for theme in ['dark','light']:
    page.evaluate("t=>{localStorage.setItem('xd-theme',t);document.documentElement.dataset.theme=t}",theme)
    for width in [360,390,768,1440]:
     page.set_viewport_size({'width':width,'height':1000});page.goto(origin+'/login?mode=register',wait_until='networkidle');assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),(theme,width,'overflow')
     if theme=='dark' and width in [390,1440]:page.screenshot(path=str(artifacts/f'registration-{width}.png'),full_page=True)
   def fill(confirmation='correct-password-123'):
    page.locator('[name=email]').fill('player@example.test');page.locator('[name=login]').fill('Player_XD');page.locator('[name=password]').fill('correct-password-123');page.locator('[name=confirmation]').fill(confirmation);page.locator('[name=nickname]').fill('Сокол');page.locator('[name=playerClass]').select_option('Маг');page.locator('[name=rules]').check();page.locator('[name=privacy]').check()
   fill('different-password-123');page.get_by_role('button',name='Создать аккаунт').click();expect(page.locator('form [role=alert]')).to_have_text('Пароли не совпадают.');assert not creates
   fill();page.get_by_role('button',name='Создать аккаунт').click();page.wait_for_url(origin+'/dashboard');assert active and len(creates)==1 and creates[0]['email_confirm'] is True;assert creates[0]['user_metadata']['login']=='player_xd' and creates[0]['user_metadata']['game_nickname']=='Сокол';assert creates[0]['user_metadata']['email_ownership_verified'] is False;assert creates[0]['user_metadata']['game_class']=='Маг'
   assert 'fixture-secret' not in page.content();context.clear_cookies();page.goto(origin+'/login',wait_until='networkidle');page.get_by_label('Email или логин',exact=True).fill('PLAYER_XD');page.get_by_label('Пароль',exact=True).fill('wrong-password');page.get_by_role('button',name='Войти',exact=False).last.click();page.locator('form [role=alert]').wait_for();assert '/login' in page.url
   page.get_by_label('Email или логин',exact=True).fill('PLAYER_XD');page.get_by_label('Пароль',exact=True).fill('correct-password-123');page.get_by_role('button',name='Войти',exact=False).last.click();page.wait_for_url(origin+'/dashboard');assert lookups[-1]['p_login']=='player_xd' and signins[-1]['email']=='player@example.test'
   context.clear_cookies();page.goto(origin+'/login',wait_until='networkidle');page.get_by_label('Email или логин',exact=True).fill('player@example.test');page.get_by_label('Пароль',exact=True).fill('correct-password-123');page.get_by_role('button',name='Войти',exact=False).last.click();page.wait_for_url(origin+'/dashboard')
   context.clear_cookies();page.goto(origin+'/login?mode=register',wait_until='networkidle');fill();page.get_by_role('button',name='Создать аккаунт').click();expect(page.locator('form [role=alert]')).to_contain_text('email или логин уже занят');assert len(creates)==2
   allowed=False;fill();page.get_by_role('button',name='Создать аккаунт').click();expect(page.locator('form [role=alert]')).to_contain_text('Слишком много попыток');assert len(creates)==2;assert not errors,errors
   print('PASS: responsive registration, password mismatch, immediate enrollment, login by email and username, wrong password, duplicate account and persistent rate gate via real Next actions; no external accounts',flush=True);browser.close()
 finally:server.terminate();server.wait(timeout=15);fixture.shutdown()
