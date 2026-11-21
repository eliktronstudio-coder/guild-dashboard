"""Direct payments navigation against isolated fixtures; never touches production."""
from pathlib import Path
exec(compile(Path(__file__).with_name('check-command-center.py').read_text().split('fixture=ThreadingHTTPServer')[0],__file__,'exec'))
STAFF=False
class ArchiveFixture(Fixture):
 def do_POST(self):
  self.payload=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or '{}');self.reply()
 def reply(self):
  path=urllib.parse.urlsplit(self.path).path;p=getattr(self,'payload',{});q=urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
  if path.endswith('/rpc/has_permission'):data=STAFF or p.get('permission')=='members.read'
  elif path.endswith('/rpc/dashboard_report'):data={**report,'finance':report['finance'] if STAFF else None}
  elif path.endswith('/treasury_award_accounts'):
   data=[{'id':f'90000000-0000-4000-8000-{i:012d}','membership_id':MEMBER,'nickname':member['nickname'],'amount_units':'10000','paid_units':'0','pending_units':'10000','version':1,'allocation_voided_at':None,'source':'prime','event_title':'Тестовая активность','reason':'Тестовое начисление'} for i in range(11)]
   offset=int(self.headers.get('Range','0-9').split('-')[0]) if self.headers.get('Range') else int(q.get('offset',['0'])[0]);data=data[offset:offset+10]
  else:return super().reply()
  encoded=json.dumps(data).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(encoded)));self.send_header('Content-Range','0-9/11' if path.endswith('/treasury_award_accounts') else '0-0/1');self.end_headers();self.wfile.write(encoded)

fixture=ThreadingHTTPServer(('127.0.0.1',0),ArchiveFixture);Thread(target=fixture.serve_forever,daemon=True).start()
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
origin=f'http://127.0.0.1:{port}';env={**os.environ,'NEXT_PUBLIC_SUPABASE_URL':f'http://127.0.0.1:{fixture.server_port}','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':'fixture-key','APP_ORIGIN':origin}
access=b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':USER,'aud':'authenticated','role':'authenticated','exp':int(now)+3600})+'.c2lnbmF0dXJl';cookie='base64-'+b64({'access_token':access,'refresh_token':'fixture-refresh','token_type':'bearer','expires_at':int(now)+3600,'user':{'id':USER,'aud':'authenticated','role':'authenticated','email':'fixture@example.test'}})
artifacts=Path('/workspace/xd-period-artifacts');artifacts.mkdir(exist_ok=True)
with tempfile.TemporaryFile() as log:
 server=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',str(port)],cwd=ROOT,env=env,stdout=log,stderr=log)
 try:
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox']);context=browser.new_context(locale='ru-RU');context.add_cookies([{'name':'sb-127-auth-token','value':cookie,'url':origin}]);page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   for i in range(100):
    try:page.goto(origin+'/login');break
    except Exception:time.sleep(.2)
   for staff in [False,True]:
    STAFF=staff
    for width in [390,1440]:
     context.clear_cookies();context.add_cookies([{'name':'sb-127-auth-token','value':cookie,'url':origin}]);page.set_viewport_size({'width':width,'height':1000})
     page.goto(origin+('/treasury' if staff else '/dashboard'),wait_until='networkidle')
     if staff:page.get_by_role('link',name='Начисления и выплаты →',exact=True).click()
     else:
      if width==390:page.get_by_role('button',name='Открыть меню',exact=True).click()
      page.get_by_role('link',name='Выплаты',exact=True).click()
     page.wait_for_url(origin+'/payments',wait_until='networkidle')
     expect(page.get_by_role('heading',name='Мои начисления',exact=True)).to_be_visible()
     expect(page.get_by_role('link',name='Выплаты',exact=True,include_hidden=True)).to_have_attribute('aria-current','page')
     assert page.locator('summary').filter(has_text='Записать выплату').count()>0 if staff else page.locator('summary').filter(has_text='Записать выплату').count()==0
     page.get_by_role('link',name='Далее →',exact=True).click();page.wait_for_url('**/payments?apage=2#settlements',wait_until='networkidle')
     page.goto(origin+'/payments?apage=999',wait_until='networkidle');page.wait_for_url('**/payments?apage=2#settlements',wait_until='networkidle')
     if staff:
      page.goto(origin+'/treasury',wait_until='networkidle')
      if width==390:page.get_by_role('button',name='Открыть меню',exact=True).click()
      page.get_by_role('link',name='Выплаты',exact=True).click();page.wait_for_url(origin+'/payments',wait_until='networkidle')
     assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
   assert not errors,errors
   browser.close();print('PASS: Payments sidebar click opens standalone page for member without treasury.read and staff; active navigation, payment permissions, pagination and oversized page stay on /payments; 390/1440px; isolated fixtures')
 finally:server.terminate();server.wait(timeout=15);fixture.shutdown()
