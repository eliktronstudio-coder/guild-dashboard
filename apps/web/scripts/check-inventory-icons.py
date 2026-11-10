"""Inventory bag and mutations against isolated authenticated fixtures only."""
from pathlib import Path
exec(compile(Path(__file__).with_name('check-command-center.py').read_text().split('fixture=ThreadingHTTPServer')[0],__file__,'exec'))
ITEM='55555555-5555-4555-8555-555555555555'
PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII='
stock={};auctions={};operations=[]
def reset():
 stock.clear();stock.update({'id':ITEM,'guild_id':GUILD,'event_id':EVENT,'source':'prime','name':'Адамантовый коготь','category':'Материалы','quantity_total':10,'quantity_remaining':10,'estimated_unit_units':'20000000','estimated_total_units':'200000000','note':'Внутренняя заметка партии','version':1,'event_title':'Получен на склад'});auctions.clear()
class InventoryFixture(Fixture):
 def do_POST(self):
  self.payload=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or '{}');p=self.payload;path=urllib.parse.urlsplit(self.path).path;operations.append((path,p))
  if path.endswith('/rpc/list_inventory_auction'):
   auctions[p['p_request']]={'id':p['p_request'],'loot_id':ITEM,'quantity':p['p_quantity'],'quantity_remaining':p['p_quantity'],'unit_price_units':p['p_unit_price'],'status':'active','version':1,'created_at':start};stock['version']+=1
  elif path.endswith('/rpc/record_inventory_sale') or path.endswith('/rpc/discard_inventory_stock'):
   stock['quantity_remaining']-=p['p_quantity'];stock['version']+=1
  elif path.endswith('/rpc/cancel_inventory_auction'):auctions[p['p_auction']]['status']='cancelled';auctions[p['p_auction']]['version']+=1;stock['version']+=1
  elif path.endswith('/rpc/complete_inventory_auction'):
   a=auctions[p['p_auction']];a['quantity_remaining']-=p['p_quantity'];a['status']='active' if a['quantity_remaining'] else 'sold';a['version']+=1;stock['quantity_remaining']-=p['p_quantity'];stock['version']+=1
  self.reply()
 def reply(self):
  path=urllib.parse.urlsplit(self.path).path
  data=None
  if path.endswith('/treasury_inventory'):
   reserved=sum(a['quantity_remaining'] for a in auctions.values() if a['status']=='active');data=[{**stock,'auction_quantity':reserved,'available_quantity':stock['quantity_remaining']-reserved}]
  elif path.endswith('/treasury_loot'):data=[{'catalog_photo':PNG}]
  elif path.endswith('/inventory_auctions'):data=[a for a in auctions.values() if a['status']=='active']
  elif any(path.endswith('/rpc/'+n) for n in ['list_inventory_auction','record_inventory_sale','discard_inventory_stock','complete_inventory_auction','cancel_inventory_auction']):data='ok'
  else:return super().reply()
  b=json.dumps(data).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(b)));self.send_header('Content-Range',f'0-{max(0,len(data)-1)}/{len(data)}');self.end_headers();self.wfile.write(b)
reset();fixture=ThreadingHTTPServer(('127.0.0.1',0),InventoryFixture);Thread(target=fixture.serve_forever,daemon=True).start()
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
origin=f'http://127.0.0.1:{port}';env={**os.environ,'NEXT_PUBLIC_SUPABASE_URL':f'http://127.0.0.1:{fixture.server_port}','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':'fixture-key','APP_ORIGIN':origin}
access=b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':USER,'aud':'authenticated','role':'authenticated','exp':int(now)+3600})+'.c2lnbmF0dXJl';cookie='base64-'+b64({'access_token':access,'refresh_token':'fixture-refresh','token_type':'bearer','expires_at':int(now)+3600,'user':{'id':USER,'aud':'authenticated','role':'authenticated','email':'fixture@example.test'}})
artifacts=Path('/workspace/xd-inventory-artifacts');artifacts.mkdir(exist_ok=True)
with tempfile.TemporaryFile() as log:
 server=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',str(port)],cwd=ROOT,env=env,stdout=log,stderr=log)
 try:
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox']);context=browser.new_context(locale='ru-RU');context.add_cookies([{'name':'sb-127-auth-token','value':cookie,'url':origin}]);page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   for i in range(100):
    try:page.goto(origin+'/login');break
    except Exception:time.sleep(.2)
   for width in [390,1440]:
    reset();page.set_viewport_size({'width':width,'height':1000});page.goto(origin+'/treasury',wait_until='networkidle');icon=page.get_by_role('button',name='Адамантовый коготь: в наличии 10. Открыть предмет');expect(icon).to_be_visible();expect(page.locator('.inventory-bag .character-card')).to_have_count(0);icon.hover();tip=page.get_by_role('tooltip');expect(tip).to_be_visible();expect(tip).to_contain_text('Острый фигурный клинок');expect(tip.get_by_role('link',name='ArcheAge Codex ↗')).to_have_attribute('href','https://archeagecodex.com/ru/item/42570/');page.screenshot(path=str(artifacts/f'tooltip-{width}.png'))
    icon.click();dialog=page.get_by_role('dialog');expect(dialog).to_be_visible();dialog.get_by_role('button',name='Аукцион',exact=True).click();form=dialog.locator('form:visible').first;form.get_by_label('Количество',exact=True).fill('6');form.get_by_label('Цена за единицу, золото',exact=True).fill('100');form.get_by_role('checkbox').check();form.get_by_role('button',name='Записать выставление на аукцион',exact=True).click();expect(dialog.get_by_role('heading',name='Лот · осталось 6 шт.')).to_be_visible();expect(page.locator('.loot-auction-badge')).to_have_text('А');page.screenshot(path=str(artifacts/f'auction-{width}.png'))
    dialog.get_by_role('button',name='Продать',exact=True).click();form=dialog.locator('form:visible').first;form.get_by_label('Количество',exact=True).fill('2');form.get_by_label('Кому продано').fill('Покупатель');form.get_by_label('Общая сумма этой продажи, золото').fill('4000');form.get_by_role('checkbox').check();form.get_by_role('button',name='Записать продажу',exact=True).click();expect(dialog.locator('.inventory-stock-line')).to_contain_text('На складе: 8');assert any(path.endswith('/record_inventory_sale') and p['p_buyer']=='Покупатель' for path,p in operations)
    dialog.get_by_role('button',name='Аукцион',exact=True).click();dialog.get_by_text('Снять непроданный лот',exact=True).click();form=dialog.locator('form:visible').first;form.get_by_role('checkbox').check();form.get_by_role('button',name='Вернуть на склад',exact=True).click();expect(dialog.get_by_text('Активных лотов нет.',exact=True)).to_be_visible();expect(dialog.locator('.inventory-stock-line')).to_contain_text('доступно: 8');dialog.get_by_role('button',name='Удалить',exact=True).click();form=dialog.locator('form:visible').first;form.get_by_label('Количество',exact=True).fill('2');form.get_by_label('Причина удаления').fill('Ошибочно внесённое количество');form.get_by_role('checkbox').check();form.get_by_role('button',name='Списать указанное количество',exact=True).click();expect(dialog.locator('.inventory-stock-line')).to_contain_text('На складе: 6');page.screenshot(path=str(artifacts/f'discard-{width}.png'));dialog.get_by_role('button',name='Закрыть предмет').click();expect(dialog).not_to_be_visible();expect(page.locator('.loot-icon-quantity')).to_have_text('6');assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
   assert not errors,errors;browser.close();print('PASS: compact bag, Codex properties/source, modal, auction reservation/cancellation, buyer sale, quantity disposal; 390/1440px; fixtures only')
 finally:server.terminate();server.wait(timeout=15);fixture.shutdown()
