"""Archive rendering and close action against isolated fixtures; never touches production."""
from pathlib import Path
exec(compile(Path(__file__).with_name('check-command-center.py').read_text().split('fixture=ThreadingHTTPServer')[0],__file__,'exec'))
closed=False
selected='2026-09-15'
class ArchiveFixture(Fixture):
 def reply(self):
  global closed
  path=urllib.parse.urlsplit(self.path).path
  if path.endswith('/rpc/close_payroll_period'):
   closed=True;self.send_response(204);self.end_headers();return
  return super().reply()
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
   for width in [390,1440]:
    page.set_viewport_size({'width':width,'height':1000})
    page.goto(origin+'/dashboard',wait_until='networkidle')
    expect(page.get_by_label('Расчётный период',exact=True)).to_have_count(0)
    expect(page.get_by_text('Конец расчётного диапазона',exact=True)).to_have_count(0)
    expect(page.get_by_text('Предыдущий период ожидает архивации',exact=True)).to_have_count(0)
    expect(page.get_by_role('link',name='Архив и закрытие',exact=True)).to_have_count(0)
    expect(page.get_by_role('heading',name='До активностей',exact=True)).to_be_visible()
    page.goto(origin+'/archive?from='+selected,wait_until='networkidle')
    expect(page.get_by_text('Расчётные периоды временно отключены.',exact=False)).to_be_visible()
    expect(page.get_by_role('button',name='Архивировать период',exact=True)).to_have_count(0)
    assert not closed
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
   assert not errors,errors
   browser.close();print('PASS: period controls, countdown and closing reminders hidden; direct archive route paused; game countdown retained; no closing RPC; 390/1440px; fixtures only')
 finally:server.terminate();server.wait(timeout=15);fixture.shutdown()
