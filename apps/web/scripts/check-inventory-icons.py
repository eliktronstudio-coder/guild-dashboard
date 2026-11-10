"""Both warehouse panes and quantity workflows; isolated authenticated fixtures only."""
from pathlib import Path
exec(compile(Path(__file__).with_name('check-command-center.py').read_text().split('fixture=ThreadingHTTPServer')[0],__file__,'exec'))
ITEM='55555555-5555-4555-8555-555555555555'
PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII='
stock={};auctions={};operations=[];instant_sales=[]
def reset():
 stock.clear();stock.update({'id':ITEM,'guild_id':GUILD,'event_id':EVENT,'source':'prime','name':'Адамантовый коготь','category':'Материалы','quantity_total':10,'quantity_remaining':10,'xd_quantity':0,'xd_received_at':start,'estimated_unit_units':'20000000','estimated_total_units':'200000000','note':'Примечание партии','version':1,'event_title':'Получен на склад'});auctions.clear();instant_sales.clear();totals.update({'prime_units':'0','mini_units':'0','guild_units':'0'})
class InventoryFixture(Fixture):
 def do_POST(self):
  self.payload=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or '{}');p=self.payload;path=urllib.parse.urlsplit(self.path).path;operations.append((path,p))
  if path.endswith('/rpc/transfer_inventory_to_xd'):stock['xd_quantity']+=p['p_quantity'];stock['version']+=1
  elif path.endswith('/rpc/sell_inventory_auction_now'):
   gross=int(p['p_unit_price'])*p['p_quantity'];cut=gross*3//10;stock['quantity_remaining']-=p['p_quantity'];stock['xd_quantity']-=p['p_quantity'];stock['version']+=2;totals['prime_units']=str(int(totals['prime_units'])+gross-cut);totals['guild_units']=str(int(totals['guild_units'])+cut);instant_sales.append({'id':p['p_request'],'source':'prime','item_name':stock['name'],'event_id':EVENT,'event_title':'Получен на склад','quantity':p['p_quantity'],'gross_units':str(gross),'guild_units':str(cut),'fund_units':str(gross-cut),'note':'','created_at':start,'voided_at':None,'void_reason':None,'buyer_name':'Аукцион','sale_channel':'auction'})
  elif path.endswith('/rpc/record_inventory_sale'):stock['quantity_remaining']-=p['p_quantity'];stock['xd_quantity']-=p['p_quantity'];stock['version']+=1
  elif path.endswith('/rpc/discard_inventory_position'):
   stock['quantity_remaining']-=p['p_quantity'];stock['version']+=1
   if p['p_warehouse']=='xd':stock['xd_quantity']-=p['p_quantity']
  elif path.endswith('/rpc/sell_pending_auction_now'):
   a=auctions[p['p_auction']];quantity=a['quantity_remaining'];stock['quantity_remaining']-=quantity;stock['xd_quantity']-=quantity;stock['version']+=1;a['quantity_remaining']=0;a['status']='sold'
  self.reply()
 def reply(self):
  path=urllib.parse.urlsplit(self.path).path;q=urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
  if path.endswith('/treasury_inventory'):
   reserved=sum(a['quantity_remaining'] for a in auctions.values() if a['status']=='active');row={**stock,'general_quantity':stock['quantity_remaining']-stock['xd_quantity'],'auction_quantity':reserved,'available_quantity':stock['quantity_remaining']-reserved};position='xd_quantity' if 'xd_quantity' in q else 'general_quantity';data=[row] if row[position]>0 else []
  elif path.endswith('/treasury_sales_log'):data=instant_sales
  elif path.endswith('/treasury_loot'):data=[{'catalog_photo':PNG}]
  elif path.endswith('/inventory_auctions'):data=[a for a in auctions.values() if a['status']=='active']
  elif any(path.endswith('/rpc/'+n) for n in ['transfer_inventory_to_xd','sell_inventory_auction_now','record_inventory_sale','discard_inventory_position','sell_pending_auction_now']):data='ok'
  else:return super().reply()
  b=json.dumps(data).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(b)));self.send_header('Content-Range',f'0-{max(0,len(data)-1)}/{len(data)}');self.end_headers();self.wfile.write(b)
reset();fixture=ThreadingHTTPServer(('127.0.0.1',0),InventoryFixture);Thread(target=fixture.serve_forever,daemon=True).start()
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
origin=f'http://127.0.0.1:{port}';env={**os.environ,'NEXT_PUBLIC_SUPABASE_URL':f'http://127.0.0.1:{fixture.server_port}','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':'fixture-key','APP_ORIGIN':origin}
access=b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':USER,'aud':'authenticated','role':'authenticated','exp':int(now)+3600})+'.c2lnbmF0dXJl';cookie='base64-'+b64({'access_token':access,'refresh_token':'fixture-refresh','token_type':'bearer','expires_at':int(now)+3600,'user':{'id':USER,'aud':'authenticated','role':'authenticated','email':'fixture@example.test'}})
artifacts=Path('/workspace/xd-two-inventories-artifacts');artifacts.mkdir(exist_ok=True)
with tempfile.TemporaryFile() as log:
 server=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',str(port)],cwd=ROOT,env=env,stdout=log,stderr=log)
 try:
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox']);context=browser.new_context(locale='ru-RU');context.add_cookies([{'name':'sb-127-auth-token','value':cookie,'url':origin}]);page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   for i in range(100):
    try:page.goto(origin+'/login');break
    except Exception:time.sleep(.2)
   for width in [390,1440]:
    reset();page.set_viewport_size({'width':width,'height':1000});page.goto(origin+'/treasury',wait_until='networkidle');general=page.get_by_role('region',name='Общий инвентарь',exact=True);xd=page.get_by_role('region',name='Инвентарь ХД',exact=True);expect(general).to_be_visible();expect(xd).to_be_visible();expect(xd.locator('.loot-icon-button')).to_have_count(0)
    general.get_by_role('button',name='Адамантовый коготь: в наличии 10. Открыть предмет').click();dialog=page.get_by_role('dialog');expect(dialog.get_by_role('button',name='Продать',exact=True)).to_have_count(0);expect(dialog.get_by_role('button',name='Аукцион',exact=True)).to_have_count(0);expect(dialog.get_by_label('Кому продано')).to_have_count(0)
    form=dialog.locator('form:visible').first;form.get_by_label('Количество',exact=True).fill('4');form.get_by_role('button',name='Перенести в инвентарь ХД',exact=True).click();expect(general.locator('.loot-icon-quantity')).to_have_text('6');expect(xd.locator('.loot-icon-quantity')).to_have_text('4');assert totals['prime_units']=='0' and totals['guild_units']=='0'
    if dialog.is_visible():dialog.get_by_role('button',name='Закрыть предмет').click()
    a=general.bounding_box();b=xd.bounding_box();assert (abs(a['y']-b['y'])<2 and a['x']+a['width']<=b['x']+1) if width>760 else b['y']>=a['y']+a['height'];page.locator('#inventory').screenshot(path=str(artifacts/f'two-panes-{width}.png'))
    assert page.locator('#inventory').evaluate('(root)=>{const ids=[...root.querySelectorAll("[id]")].map(x=>x.id);return ids.length===new Set(ids).size}')
    xd.get_by_role('button',name='Адамантовый коготь: в наличии 4. Открыть предмет').click();dialog=page.get_by_role('dialog');expect(dialog.get_by_role('button',name='В инвентарь ХД',exact=True)).to_have_count(0);dialog.get_by_role('button',name='Аукцион',exact=True).click();form=dialog.locator('form:visible').first;form.get_by_label('Количество',exact=True).fill('2');form.get_by_label('Цена за единицу, золото',exact=True).fill('100');form.get_by_role('checkbox').check();form.get_by_role('button',name='Выставить и записать продажу',exact=True).click();expect(xd.locator('.loot-icon-quantity')).to_have_text('2');expect(general.locator('.loot-icon-quantity')).to_have_text('6')
    dialog.get_by_role('button',name='Продать',exact=True).click();form=dialog.locator('form:visible').first;form.get_by_label('Количество',exact=True).fill('1');form.get_by_label('Кому продано').fill('Покупатель');form.get_by_label('Общая сумма этой продажи, золото').fill('2000');form.get_by_role('checkbox').check();form.get_by_role('button',name='Записать продажу',exact=True).click();expect(xd.locator('.loot-icon-quantity')).to_have_text('1');dialog.get_by_role('button',name='Закрыть предмет').click()
    general.get_by_role('button',name='Адамантовый коготь: в наличии 6. Открыть предмет').click();dialog=page.get_by_role('dialog');dialog.get_by_role('button',name='Удалить',exact=True).click();form=dialog.locator('form:visible').first;form.get_by_label('Количество',exact=True).fill('1');form.get_by_label('Причина удаления').fill('Удаление из общего склада');form.get_by_role('checkbox').check();form.get_by_role('button',name='Списать указанное количество',exact=True).click();expect(general.locator('.loot-icon-quantity')).to_have_text('5');expect(xd.locator('.loot-icon-quantity')).to_have_text('1');dialog.get_by_role('button',name='Закрыть предмет').click()
    xd.get_by_role('button',name='Адамантовый коготь: в наличии 1. Открыть предмет').click();dialog=page.get_by_role('dialog');dialog.get_by_role('button',name='Удалить',exact=True).click();form=dialog.locator('form:visible').first;form.get_by_label('Количество',exact=True).fill('1');form.get_by_label('Причина удаления').fill('Удаление из склада ХД');form.get_by_role('checkbox').check();form.get_by_role('button',name='Списать указанное количество',exact=True).click();expect(xd.locator('.loot-icon-button')).to_have_count(0);expect(general.locator('.loot-icon-quantity')).to_have_text('5');assert stock['quantity_remaining']==5;assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
   assert not errors,errors;browser.close();print('PASS: both panes visible, desktop side-by-side/mobile stacked, no general selling/buyer fields, partial transfer, XD buyer/auction sales, per-position deletion, stable totals and unique IDs; isolated fixtures')
 finally:server.terminate();server.wait(timeout=15);fixture.shutdown()
