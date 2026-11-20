"""Archive UI uses isolated Supabase fixtures; never archives production activities."""
from pathlib import Path
exec(compile(Path(__file__).with_name('check-command-center.py').read_text().split('fixture=ThreadingHTTPServer')[0],__file__,'exec'))
STAFF=True;archived=False;fail_once=True
journal_row={**event,'version':1,'difficulty':'normal','is_night':False,'has_banner':False,'participants':1,'percentage':100,'journal_status':'completed'}
class ArchiveFixture(Fixture):
 def do_HEAD(self):
  self.send_response(200);self.send_header('Content-Range','*/'+('0' if archived else '1'));self.end_headers()
 def do_POST(self):
  self.payload=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or '{}');self.reply()
 def reply(self):
  global archived,fail_once
  path=urllib.parse.urlsplit(self.path).path;p=getattr(self,'payload',{});status=200
  if path.endswith('/rpc/has_permission'):data=STAFF or p.get('permission') not in ['periods.close','events.manage']
  elif path.endswith('/rpc/archive_activities'):
   if fail_once:fail_once=False;status=400;data={'code':'P0001','message':'NO_ACTIVITIES'}
   else:archived=True;data=1
  elif path.endswith('/rpc/activity_journal'):
   include=bool(p.get('p_filters',{}).get('archive')=='1')==archived
   data={'total':1 if include else 0,'page':1,'can_view_roster':True,'kpis':{'total':1 if include else 0,'average':1,'best':1,'cancelled':0},'rows':[journal_row] if include else []}
  else:return super().reply()
  encoded=json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(encoded)));self.end_headers();self.wfile.write(encoded)
fixture=ThreadingHTTPServer(('127.0.0.1',0),ArchiveFixture);Thread(target=fixture.serve_forever,daemon=True).start()
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
origin=f'http://127.0.0.1:{port}';env={**os.environ,'NEXT_PUBLIC_SUPABASE_URL':f'http://127.0.0.1:{fixture.server_port}','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':'fixture-key','APP_ORIGIN':origin}
access=b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':USER,'aud':'authenticated','role':'authenticated','exp':int(now)+3600})+'.c2lnbmF0dXJl';cookie='base64-'+b64({'access_token':access,'refresh_token':'fixture-refresh','token_type':'bearer','expires_at':int(now)+3600,'user':{'id':USER,'aud':'authenticated','role':'authenticated','email':'fixture@example.test'}})
artifacts=Path('/workspace/xd-activity-archive-artifacts');artifacts.mkdir(exist_ok=True)
with tempfile.TemporaryFile() as log:
 server=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',str(port)],cwd=ROOT,env=env,stdout=log,stderr=log)
 try:
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox']);context=browser.new_context(locale='ru-RU',reduced_motion='reduce');context.add_cookies([{'name':'sb-127-auth-token','value':cookie,'url':origin}]);page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   for i in range(100):
    try:page.goto(origin+'/login');break
    except Exception:time.sleep(.2)
   for width in [390,1440]:
    STAFF=True;archived=False;fail_once=True;page.set_viewport_size({'width':width,'height':1000})
    page.goto(origin+'/events',wait_until='networkidle');page.get_by_role('link',name='Архивировать активности',exact=True).click();page.wait_for_url(origin+'/events/archive',wait_until='networkidle')
    expect(page.get_by_role('heading',name='К архивации: 1',exact=True)).to_be_visible()
    page.screenshot(path=str(artifacts/f'archive-form-{width}.png'),full_page=True)
    page.get_by_label('Дата с',exact=True).fill(start[:10]);page.get_by_label('Дата по',exact=True).fill(start[:10]);page.get_by_role('button',name='Показать количество',exact=True).click();page.wait_for_load_state('networkidle')
    page.get_by_role('checkbox').check();page.get_by_role('button',name='Архивировать активности',exact=True).click();expect(page.locator('p[role=alert]')).to_contain_text('нет неархивированных')
    page.get_by_role('checkbox').check();page.get_by_role('button',name='Архивировать активности',exact=True).click();expect(page.get_by_role('heading',name='К архивации: 0',exact=True)).to_be_visible()
    page.get_by_role('link',name='Открыть архив за эти даты →',exact=True).click();page.wait_for_load_state('networkidle');expect(page.get_by_role('heading',name='Архив активностей',exact=True)).to_be_visible();expect(page.get_by_role('link',name=event['title'],exact=True)).to_be_visible()
    page.screenshot(path=str(artifacts/f'archive-journal-{width}.png'),full_page=True)
    page.get_by_role('link',name='Текущие активности',exact=True).click();page.wait_for_load_state('networkidle');expect(page.get_by_role('link',name=event['title'],exact=True)).to_have_count(0)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
   STAFF=False;page.goto(origin+'/events',wait_until='networkidle');expect(page.get_by_role('link',name='Архивировать активности',exact=True)).to_have_count(0)
   page.goto(origin+'/events/archive',wait_until='networkidle');expect(page.get_by_role('button',name='Архивировать активности',exact=True)).to_have_count(0)
   assert not errors,errors
   browser.close()
  print('PASS: archive date selection, preview, error without mutation, successful archive, current/archive journal toggle and staff ACL; 390/1440px; isolated fixtures only')
 finally:server.terminate();server.wait(timeout=15);fixture.shutdown()
