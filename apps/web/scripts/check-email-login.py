"""Real Next email-link actions against isolated Auth/DB; never touches live users."""
from pathlib import Path
exec(compile(Path(__file__).with_name('check-command-center.py').read_text().split('fixture=ThreadingHTTPServer')[0], __file__, 'exec'))
import copy
updates=[];signins=[];allowed=True;generation=0;linked_password=None;expiry=int(time.time())+3600
user={'id':USER,'aud':'authenticated','role':'authenticated','app_metadata':{'provider':'custom:telegram'},'identities':[{'id':'77777777-7777-4777-8777-777777777777','user_id':USER,'provider':'custom:telegram','identity_data':{'sub':'fixture-telegram'}}],'user_metadata':{'game_nickname':'Тестовый участник','keep':'existing'},'created_at':'2024-01-01T00:00:00Z'}
site_snapshot=copy.deepcopy((member,report,totals,personal))
def token():return b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':USER,'aud':'authenticated','role':'authenticated','session_id':'66666666-6666-4666-8666-666666666666','generation':generation,'exp':expiry})+'.c2lnbmF0dXJl'
class EmailFixture(Fixture):
 def send(self,data,status=200):
  raw=json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
 def payload(self):return json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or '{}')
 def do_PUT(self):
  global generation,linked_password
  assert urllib.parse.urlsplit(self.path).path=='/auth/v1/admin/users/'+USER,'Only the original user may be updated'
  assert self.headers.get('apikey')=='fixture-secret'
  payload=self.payload();updates.append(payload)
  if payload['email']=='occupied@example.test':return self.send({'message':'Email already exists','code':'email_exists'},422)
  assert payload['email_confirm'] is True and payload['user_metadata']['keep']=='existing'
  user.update({'email':payload['email'],'email_confirmed_at':'2026-11-16T00:00:00Z','user_metadata':payload['user_metadata']})
  user['identities'].append({'id':USER,'user_id':USER,'provider':'email','identity_data':{'sub':USER}})
  generation+=1;linked_password=payload['password'] # The real Auth service revokes old sessions here.
  return self.send(user)
 def do_POST(self):
  payload=self.payload();path=urllib.parse.urlsplit(self.path).path
  if path.endswith('/rpc/claim_auth_attempt'):return self.send(allowed)
  if path=='/auth/v1/token':
   signins.append(payload)
   if payload.get('email')!=user.get('email') or payload.get('password')!=linked_password:return self.send({'message':'Invalid credentials','code':'invalid_credentials'},400)
   return self.send({'access_token':token(),'refresh_token':'fixture-refresh','token_type':'bearer','expires_in':3600,'user':user})
  assert not path.startswith('/auth/v1/admin/'),'Must never create or merge another user'
  self.reply()
 def reply(self):
  path=urllib.parse.urlsplit(self.path).path
  if path=='/auth/v1/admin/users/'+USER:
   assert self.headers.get('apikey')=='fixture-secret'
   return self.send(user)
  if path=='/auth/v1/user':
   if self.headers.get('Authorization')!='Bearer '+token():return self.send({'message':'Session expired','code':'session_not_found'},401)
   return self.send(user)
  super().reply()
fixture=ThreadingHTTPServer(('127.0.0.1',0),EmailFixture);Thread(target=fixture.serve_forever,daemon=True).start()
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
origin=f'http://127.0.0.1:{port}';env={**os.environ,'NEXT_PUBLIC_SUPABASE_URL':f'http://127.0.0.1:{fixture.server_port}','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':'fixture-key','SUPABASE_SECRET_KEY':'fixture-secret','APP_ORIGIN':origin,'AUTH_EMAIL_ENABLED':'true','AUTH_EMAIL_DELIVERY_READY':'false'}
with tempfile.TemporaryFile() as log:
 server=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',str(port)],cwd=ROOT,env=env,stdout=log,stderr=log)
 try:
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox']);context=browser.new_context(locale='ru-RU');page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   for attempt in range(100):
    try:page.goto(origin+'/login');break
    except Exception:time.sleep(.2)
   page.goto(origin+'/account/email');page.wait_for_url('**/login');assert not updates
   cookie='base64-'+b64({'access_token':token(),'refresh_token':'fixture-refresh','token_type':'bearer','expires_at':int(time.time())+3600,'user':user})
   context.add_cookies([{'name':'sb-127-auth-token','value':cookie,'url':origin}])
   page.goto(origin+'/account/email',wait_until='networkidle');stale=context.new_page();stale.goto(origin+'/account/email',wait_until='networkidle')
   def fill(target,email):
    target.get_by_label('Email',exact=True).fill(email);target.get_by_label('Пароль',exact=True).fill('fixture-password-123');target.get_by_label('Повторите пароль',exact=True).fill('fixture-password-123');target.locator('input[name=confirm]').check()
   fill(page,'occupied@example.test');page.get_by_role('button',name='Подключить вход по email').click();expect(page.locator('form [role=alert]')).to_contain_text('адрес уже занят');assert 'email' not in user and len(updates)==1
   allowed=False;fill(page,'player@example.test');page.get_by_role('button',name='Подключить вход по email').click();expect(page.locator('form [role=alert]')).to_contain_text('Слишком много попыток');assert len(updates)==1
   allowed=True;fill(page,'player@example.test');page.get_by_role('button',name='Подключить вход по email').click();page.wait_for_url(origin+'/account?notice=email_linked');expect(page.get_by_role('status')).to_contain_text('Все данные сохранены');assert len(updates)==2 and signins and user['id']==USER
   fill(stale,'different@example.test');stale.get_by_role('button',name='Подключить вход по email').click();expect(stale.locator('form [role=alert]')).to_contain_text('уже подключён');assert len(updates)==2 and user['email']=='player@example.test'
   assert 'fixture-secret' not in page.content() and 'fixture-password-123' not in page.content()
   context.clear_cookies();page.goto(origin+'/login',wait_until='networkidle');page.get_by_label('Email или логин',exact=True).fill('player@example.test');page.get_by_label('Пароль',exact=True).fill('fixture-password-123');page.get_by_role('button',name='Войти',exact=False).last.click();page.wait_for_url(origin+'/dashboard')
   assert user['id']==USER and any(i['provider']=='custom:telegram' for i in user['identities'])
   assert copy.deepcopy((member,report,totals,personal))==site_snapshot and not errors,errors
   print('PASS: same account ID and site data; occupied email and rate rejection; automatic same-ID password session after old-session revocation; stale form cannot replace email; subsequent email login; no new users or live services',flush=True);browser.close()
 finally:server.terminate();server.wait(timeout=15);fixture.shutdown()
