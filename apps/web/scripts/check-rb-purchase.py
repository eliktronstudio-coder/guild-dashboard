"""Run the experience calculator against local authenticated fixtures; no live writes."""
from pathlib import Path
exec(compile(Path(__file__).with_name('check-command-center.py').read_text().split('\nfixture=ThreadingHTTPServer')[0],__file__,'exec'))
import re
participants=[{'id':'10000000-0000-4000-8000-000000000001','nickname':'Игрок 20','attendance_tenths':200},{'id':'10000000-0000-4000-8000-000000000002','nickname':'Игрок 40','attendance_tenths':400},{'id':'10000000-0000-4000-8000-000000000003','nickname':'Игрок 80','attendance_tenths':800}]
class RbFixture(Fixture):
 def do_POST(self):
  if self.path.endswith('/rpc/rb_purchase_candidates'):
   p=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or '{}');data={'from':p['p_from'],'until':'2026-11-15','participants':participants};raw=json.dumps(data).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw);return
  return super().do_POST()
fixture=ThreadingHTTPServer(('127.0.0.1',0),RbFixture);Thread(target=fixture.serve_forever,daemon=True).start()
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
origin=f'http://127.0.0.1:{port}';env={**os.environ,'NEXT_PUBLIC_SUPABASE_URL':f'http://127.0.0.1:{fixture.server_port}','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':'fixture-key','APP_ORIGIN':origin}
access=b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':USER,'aud':'authenticated','role':'authenticated','exp':int(now)+3600})+'.c2lnbmF0dXJl';cookie='base64-'+b64({'access_token':access,'refresh_token':'fixture-refresh','token_type':'bearer','expires_at':int(now)+3600,'user':{'id':USER,'aud':'authenticated','role':'authenticated','email':'fixture@example.test'}})
artifacts=Path('/workspace/xd-rb-artifacts');artifacts.mkdir(exist_ok=True)
with tempfile.TemporaryFile() as log:
 server=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',str(port)],cwd=ROOT,env=env,stdout=log,stderr=log)
 try:
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox']);context=browser.new_context(locale='ru-RU');context.add_cookies([{'name':'sb-127-auth-token','value':cookie,'url':origin}]);page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   for i in range(100):
    try:page.goto(origin+'/rb-purchase',wait_until='networkidle');break
    except Exception:time.sleep(.2)
   expect(page.get_by_role('heading',name='Расчёт покупки РБ',exact=True)).to_be_visible();expect(page.locator('nav[aria-label="Основная навигация"] a[aria-current="page"]')).to_have_attribute('href','/rb-purchase')
   experience=page.get_by_label('Опыт РБ, ед.',exact=True);experience.fill('300')
   def checkbox(n):return page.get_by_role('checkbox',name=re.compile('Игрок '+str(n)))
   def units(n):return page.locator('table.rb-breakdown tbody tr').filter(has_text='Игрок '+str(n)).locator('td').last
   checkbox(20).check();checkbox(40).check();expect(units(20)).to_have_text('100');expect(units(40)).to_have_text('200');expect(page.get_by_role('status')).to_contain_text('300 из 300 ед.')
   checkbox(20).uncheck();expect(units(40)).to_have_text('300');expect(page.locator('table.rb-breakdown tbody tr')).to_have_count(1)
   page.get_by_role('button',name='Выбрать всех',exact=True).click();expect(units(20)).to_have_text('43');expect(units(40)).to_have_text('86');expect(units(80)).to_have_text('171')
   for theme in ['dark','light']:
    page.evaluate("theme=>{document.documentElement.dataset.theme=theme;localStorage.setItem('xd-theme',theme)}",theme)
    for width in [390,1440]:
     page.set_viewport_size({'width':width,'height':1000});assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),(theme,width,'overflow')
     if theme=='dark':page.screenshot(path=str(artifacts/f'rb-{width}.png'),full_page=True)
   page.get_by_label('Поиск по нику',exact=True).fill('40');expect(page.get_by_role('checkbox')).to_have_count(1);checkbox(40).uncheck();expect(units(20)).to_have_text('60');expect(units(80)).to_have_text('240');page.get_by_label('Поиск по нику',exact=True).fill('')
   page.get_by_role('button',name='Снять выбор',exact=True).click();expect(page.locator('table.rb-breakdown')).to_have_count(0)
   experience.fill('1.5');expect(page.get_by_role('alert').filter(has_text='Укажите положительное')).to_be_visible();checkbox(20).check();experience.fill('1000000000000000000');checkbox(40).check();expect(units(20)).to_have_text('333\u202f333\u202f333\u202f333\u202f333\u202f333');expect(units(40)).to_have_text('666\u202f666\u202f666\u202f666\u202f666\u202f667')
   participants=[];page.reload(wait_until='networkidle');expect(page.get_by_text('За этот период нет участников с подтверждённой посещаемостью Мини РБ от 20%.',exact=True)).to_be_visible()
   anonymous=browser.new_context();response=anonymous.request.get(origin+'/rb-purchase');assert '/login' in response.text() and 'Игрок 20' not in response.text();assert not errors,errors
   browser.close();print('PASS: checkbox add/remove, proportional shares, exact totals and large integers, search, empty/invalid states, private access, active navigation; 390/1440px × dark/light; fixtures only',flush=True)
 finally:
  server.terminate();server.wait(timeout=15);fixture.shutdown()
