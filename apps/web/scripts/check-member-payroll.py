"""Browser acceptance against isolated fixtures. No live accounts, gold or messages."""
from pathlib import Path
exec(compile(Path(__file__).with_name('check-activity-workspace.py').read_text().split('\nfixture=ThreadingHTTPServer')[0],__file__,'exec'))
claim_id='66666666-6666-4666-8666-666666666666'
claims={};calls=[]
class PayrollFixture(WorkspaceFixture):
 def reply(self):
  path=urllib.parse.urlsplit(self.path).path;q=urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query);p=getattr(self,'payload',{})
  if path.endswith('/rpc/submit_participation_claim'):
   claims[p['p_id']]={'id':p['p_id'],'event_id':p['p_event'],'membership_id':MEMBER,'screenshot':p['p_screenshot'],'status':'pending','created_at':start};calls.append(('claim',p));return self.send(p['p_id'])
  if path.endswith('/rpc/review_participation_claim'):
   claims[p['p_id']]['status']='accepted' if p['p_accept'] else 'rejected';calls.append(('review',p));return self.send(None)
  if path.endswith('/rpc/add_registry_inventory'):calls.append(('inventory',p));return self.send(p['p_request'])
  if path.endswith('/rpc/set_member_weight'):member['payout_weight']=p['p_weight'];member['weight_version']+=1;calls.append(('coefficient',p));return self.send(None)
  if path.endswith('/rpc/pay_period_member'):calls.append(('pay',p));return self.send(None)
  if path.endswith('/rpc/delete_activity'):calls.append(('delete',p));events[p['p_event']]['status']='cancelled';return self.send(None)
  if path.endswith('/participation_claims'):
   rows=list(claims.values())
   for key in ['id','event_id','membership_id','status']:
    if q.get(key) and q[key][0].startswith('eq.'):rows=[x for x in rows if x[key]==q[key][0][3:]]
   return self.send(rows)
  if path.endswith('/attendance') and 'events!inner' not in q.get('select',[''])[0] and q.get('membership_id'):return self.send([{'mark':'absent'}])
  return super().reply()
fixture=ThreadingHTTPServer(('127.0.0.1',0),PayrollFixture);Thread(target=fixture.serve_forever,daemon=True).start()
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
origin=f'http://127.0.0.1:{port}';env={**os.environ,'NEXT_PUBLIC_SUPABASE_URL':f'http://127.0.0.1:{fixture.server_port}','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':'fixture-key','APP_ORIGIN':origin}
access=b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':USER,'aud':'authenticated','role':'authenticated','exp':int(now)+3600})+'.c2lnbmF0dXJl';cookie='base64-'+b64({'access_token':access,'refresh_token':'fixture-refresh','token_type':'bearer','expires_at':int(now)+3600,'user':{'id':USER,'aud':'authenticated','role':'authenticated','email':'fixture@example.test'}})
artifacts=Path('/workspace/xd-payroll-artifacts');artifacts.mkdir(exist_ok=True)
with tempfile.TemporaryFile() as log:
 server=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',str(port)],cwd=ROOT,env=env,stdout=log,stderr=log)
 try:
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox']);context=browser.new_context(locale='ru-RU');context.add_cookies([{'name':'sb-127-auth-token','value':cookie,'url':origin}]);page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   for i in range(100):
    try:page.goto(origin+'/dashboard');break
    except Exception:time.sleep(.2)
   expect(page.get_by_role('link',name='Главная',exact=True)).to_be_visible();expect(page.get_by_role('timer')).to_contain_text('Осталось:')
   for width in [390,1440]:
    page.set_viewport_size({'width':width,'height':1000})
    for path in ['/members','/treasury','/admin/participation',f'/events/{EVENT}']:
     response=page.goto(origin+path,wait_until='networkidle');assert response.status==200,(path,response.status)
     assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),(path,width,'overflow')
   page.goto(origin+'/members',wait_until='networkidle');expect(page.get_by_role('columnheader',name='Посещаемость',exact=True)).to_be_visible();expect(page.get_by_role('columnheader',name='Зарплата · к выплате')).to_be_visible();page.screenshot(path=str(artifacts/'roster-1440.png'),full_page=True)
   page.goto(origin+'/treasury',wait_until='networkidle');page.get_by_text('Добавить предмет',exact=True).click();form=page.locator('form').filter(has=page.get_by_role('button',name='Добавить в инвентарь'))
   expect(form.get_by_role('combobox',name='Источник',exact=True)).to_have_value('');assert form.get_by_role('combobox',name='Источник',exact=True).locator('option').first.inner_text()=='Из Сундука'
   form.get_by_role('combobox',name='Предмет из реестра дропа',exact=True).select_option(DROP);expect(form.get_by_label('Цена за единицу, золото')).to_have_value('2000');form.get_by_label('Цена за единицу, золото').fill('2500');form.get_by_role('combobox',name='Категория',exact=True).select_option('mini_rb');form.get_by_role('button',name='Добавить в инвентарь').click();expect(form.get_by_role('status')).to_contain_text('Предмет добавлен');assert calls[-1][1]['p_price']=='25000000' and calls[-1][1]['p_source']=='mini_rb' and calls[-1][1]['p_event'] is None
   payroll=page.locator('#period-payroll');payroll.get_by_text('Записать выплату',exact=True).first.click();payment=payroll.locator('form').filter(has=page.get_by_role('button',name='Подтвердить выплату')).first;payment.get_by_label('Комментарий / подтверждение передачи').fill('Передано в игре');payment.locator('input[name=confirm]').check();payment.get_by_role('button',name='Подтвердить выплату').click();expect(payment.get_by_role('status')).to_contain_text('Выплата записана');assert calls[-1][0]=='pay' and calls[-1][1]['p_signature']=='a'*32
   page.goto(origin+f'/events/{EVENT}',wait_until='networkidle');expect(page.get_by_role('link',name='Удалить активность',exact=True)).to_be_visible();page.get_by_text('Подать заявку на участие',exact=True).click()
   claim_form=page.locator('form').filter(has=page.get_by_role('button',name='Отправить заявку'));claim_form.locator('input[type=file]').set_input_files({'name':'roster.png','mimeType':'image/png','buffer':base64.b64decode(page.evaluate("()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,320,180);ctx.fillStyle='#000';ctx.fillText('Test raid roster',20,40);return c.toDataURL('image/png').split(',')[1]}"))});claim_form.get_by_alt_text('Скрин состава 1').wait_for();claim_form.get_by_role('button',name='Отправить заявку').click();page.get_by_text('Заявка: На проверке',exact=True).wait_for();assert any(k=='claim' for k,v in calls)
   page.goto(origin+'/admin/participation',wait_until='networkidle');expect(page.get_by_role('heading',name=member['nickname'],exact=True)).to_be_visible();image=page.get_by_alt_text('Скрин активности из заявки');expect(image).to_be_visible();assert image.evaluate('(img)=>img.complete && img.naturalWidth>0');page.get_by_role('button',name='Принять',exact=True).click();page.get_by_text('Новых заявок нет.',exact=True).wait_for();assert calls[-1][1]['p_accept'] is True
   page.goto(origin+f'/events/{EVENT}/delete',wait_until='networkidle');page.get_by_label('Причина',exact=True).fill('Дубликат активности');page.get_by_label('Подтверждаю удаление').check();page.get_by_role('button',name='Удалить активность',exact=True).click();page.wait_for_url(origin+'/events');assert calls[-1][0]=='delete'
   assert not errors,errors;browser.close();print('PASS: home/countdown, attendance and salary columns, chest-first registry selection and editable price, claim upload/admin screenshot/acceptance, delete; 390/1440px; isolated fixtures only',flush=True)
 finally:
  server.terminate();server.wait(timeout=15);fixture.shutdown()
