"""Exercise inventory icon interactions against local fixtures only."""
from pathlib import Path
exec(compile(Path(__file__).with_name('check-command-center.py').read_text().split('fixture=ThreadingHTTPServer')[0],__file__,'exec'))
ITEM='55555555-5555-4555-8555-555555555555'
PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII='
stock={'id':ITEM,'guild_id':GUILD,'event_id':EVENT,'source':'prime','name':'Адамантовый коготь','category':'Материалы','quantity_total':50,'quantity_remaining':37,'estimated_unit_units':'20000000','estimated_total_units':'740000000','note':'Редкий материал для изготовления снаряжения.','version':1,'event_title':'Получен на склад'}
class InventoryFixture(Fixture):
 def reply(self):
  path=urllib.parse.urlsplit(self.path).path
  if path.endswith('/treasury_inventory') or path.endswith('/treasury_loot'):
   data=[stock] if path.endswith('/treasury_inventory') else [{'catalog_photo':PNG}]
   b=json.dumps(data).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(b)));self.send_header('Content-Range','0-0/1');self.end_headers();self.wfile.write(b);return
  return super().reply()
fixture=ThreadingHTTPServer(('127.0.0.1',0),InventoryFixture);Thread(target=fixture.serve_forever,daemon=True).start()
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
origin=f'http://127.0.0.1:{port}';env={**os.environ,'NEXT_PUBLIC_SUPABASE_URL':f'http://127.0.0.1:{fixture.server_port}','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':'fixture-key','APP_ORIGIN':origin}
access=b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':USER,'aud':'authenticated','role':'authenticated','exp':int(now)+3600})+'.c2lnbmF0dXJl';cookie='base64-'+b64({'access_token':access,'refresh_token':'fixture-refresh','token_type':'bearer','expires_at':int(now)+3600,'user':{'id':USER,'aud':'authenticated','role':'authenticated','email':'fixture@example.test'}})
with tempfile.TemporaryFile() as log:
 server=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',str(port)],cwd=ROOT,env=env,stdout=log,stderr=log)
 try:
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox']);context=browser.new_context(locale='ru-RU');context.add_cookies([{'name':'sb-127-auth-token','value':cookie,'url':origin}]);page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   for i in range(100):
    try:page.goto(origin+'/login');break
    except Exception:time.sleep(.2)
   for width in [390,1440]:
    page.set_viewport_size({'width':width,'height':1000});page.goto(origin+'/treasury',wait_until='networkidle');icon=page.get_by_role('button',name='Адамантовый коготь: в наличии 37. Описание предмета');expect(icon).to_be_visible();expect(icon.locator('.loot-icon-quantity')).to_have_text('37');tip=page.get_by_role('tooltip');expect(tip).to_be_hidden();icon.hover();expect(tip).to_be_visible();expect(tip).to_contain_text(stock['note']);icon.press('Escape');expect(tip).to_be_hidden();icon.click();expect(tip).to_be_visible();expect(icon).to_have_attribute('aria-expanded','true');assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1');page.screenshot(path=f'/tmp/xd-inventory-{width}.png',full_page=True)
   assert not errors,errors
   browser.close();print('PASS: icon with live stock count, hover/focus/touch description, Escape dismissal; 390/1440px; isolated fixtures')
 finally:server.terminate();server.wait(timeout=15);fixture.shutdown()
