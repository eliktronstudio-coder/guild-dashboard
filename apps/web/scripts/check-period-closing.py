"""Archive rendering and close action against isolated fixtures; never touches production."""
from pathlib import Path
exec(compile(Path(__file__).with_name('check-activity-workspace.py').read_text().split('\nfixture=ThreadingHTTPServer')[0],__file__,'exec'))
closed=False
selected='2026-09-15'
rows=[{'id':m['id'],'nickname':m['nickname'],'status':'active','payout_weight':100,'available':'100','present':'100','percentage':100,'prime_percentage':100,'mini_percentage':100,'pvp_percentage':100,'eligible':True,'prime_projection':'35000000','mini_projection':'10000000','prime_fixed':'0','mini_fixed':'0','prime_paid':'0','mini_paid':'0'} for m in people[:4]]
report={'from':selected,'until':'2026-10-15','rows':rows,'prime_units':'140000000','mini_units':'40000000','signature':'a'*32}
archive={'id':DROP,'period_from':selected,'closed_at':'2026-10-14T15:00:00Z','snapshot':{'payroll':report,'inventory':[{'id':DROP,'name':'Непроданная эссенция','quantity':200,'source':'prime'}],'activities':[{'id':EVENT,'title':'Архивный Левиафан','starts_at':'2026-09-20T12:00:00Z','roster':[{'mark':'present'}]}]}}
class ArchiveFixture(WorkspaceFixture):
 def reply(self):
  global closed
  path=urllib.parse.urlsplit(self.path).path;q=urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
  if path.endswith('/rpc/period_payroll_report'):return self.send(report)
  if path.endswith('/period_archives'):
   if q.get('period_from'):return self.send([archive] if closed and q['period_from'][0]=='eq.'+selected else [])
   return self.send([archive] if closed else [])
  if path.endswith('/rpc/close_payroll_period'):closed=True;return self.send(DROP)
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
    closed=False;page.set_viewport_size({'width':width,'height':1000});page.goto(origin+'/archive?from='+selected,wait_until='networkidle');expect(page.get_by_role('heading',name='Закрытие периода',exact=True)).to_be_visible();expect(page.get_by_role('columnheader',name='Прайм · начислено')).to_be_visible();expect(page.get_by_role('columnheader',name='Всего',exact=True)).to_be_visible();page.screenshot(path=str(artifacts/f'closing-{width}.png'),full_page=True)
    page.get_by_label('Проверил состав и начисления.',exact=False).check();page.get_by_role('button',name='Архивировать период',exact=True).click();expect(page.get_by_role('heading',name='Закрытый период',exact=True)).to_be_visible();expect(page.get_by_text('Непроданная эссенция',exact=False)).to_be_visible();expect(page.get_by_role('link',name='Скачать исходный архив JSON →')).to_be_visible();assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1');page.screenshot(path=str(artifacts/f'archive-{width}.png'),full_page=True)
   assert not errors,errors
   browser.close();print('PASS: real server action close, immutable archive presentation, per-player accruals, received stock, export link; 390/1440px; fixtures only')
 finally:server.terminate();server.wait(timeout=15);fixture.shutdown()
