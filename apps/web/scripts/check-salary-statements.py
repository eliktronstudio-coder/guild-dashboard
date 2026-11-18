"""End-to-end salary statements, explanations, history and guild date; isolated fixtures only."""
from pathlib import Path
exec(compile(Path(__file__).with_name('check-command-center.py').read_text().split('fixture=ThreadingHTTPServer')[0],__file__,'exec'))
import copy
STATEMENT='77777777-7777-4777-8777-777777777777'
state={'locked':False,'closed':False,'paid_prime':False,'paid_mini':False,'version':1,'bonus':0,'staff':True};calls=[];snapshot=None
member.update(guild_joined_on=None,guild_join_version=1)
def row():
 return {'id':MEMBER,'nickname':member['nickname'],'status':'active','payout_weight':100,'available':'600','present':'300','percentage':50,'prime_percentage':50,'mini_percentage':50,'pvp_percentage':0,'prime_present':2,'prime_total':3,'mini_present':2,'mini_total':3,'prime_eligible':True,'mini_eligible':True,'eligible':True,'prime_projection':str((0 if state['paid_prime'] else 100000)+(0 if state['locked'] else state['bonus'])),'mini_projection':'0' if state['paid_mini'] else '200000','prime_fixed':'0','mini_fixed':'0','prime_paid':'100000' if state['paid_prime'] else '0','mini_paid':'200000' if state['paid_mini'] else '0'}
def statement():return {'id':STATEMENT,'status':'locked','created_at':start} if state['locked'] else None
class StatementFixture(Fixture):
 def do_POST(self):self.payload=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or '{}');self.reply()
 def reply(self):
  global snapshot
  path=urllib.parse.urlsplit(self.path).path;p=getattr(self,'payload',{});status=200
  if path.endswith('/rpc/has_permission'):data=state['staff'] or p.get('permission') in ['members.read','treasury.read']
  elif path.endswith('/rpc/lifetime_payroll_report'):data={'scope':'lifetime','signature':f"{state['version']:032x}",'rows':[row()],'prime_units':'100000','mini_units':'200000','statement':statement()}
  elif path.endswith('/rpc/lock_salary_statement'):
   assert p['p_signature']==f"{state['version']:032x}";calls.append(('lock',p));snapshot=copy.deepcopy(row());state['locked']=True;state['version']+=1;data=STATEMENT
  elif path.endswith('/rpc/pay_lifetime_salary'):
   assert p['p_signature']==f"{state['version']:032x}";calls.append(('pay',p));state['paid_prime' if p['p_source']=='prime' else 'paid_mini']=True;state['version']+=1;data=None
  elif path.endswith('/rpc/close_salary_statement'):
   if p['p_action']=='completed' and not(state['paid_prime'] and state['paid_mini']):status=400;data={'code':'P0001','message':'STATEMENT_UNPAID'}
   else:calls.append(('close',p));state['locked']=False;state['closed']=True;state['version']+=1;data=None
  elif path.endswith('/rpc/salary_breakdown'):
   activities=[{'id':f'event-{source}-{i}','title':f'Рейд {source} {i}','starts_at':start,'source':source,'weight':w,'present':i<2} for source in ['prime','mini_rb'] for i,w in enumerate([50,100,150])]
   data={'row':row(),'statement':statement(),'guild_joined_on':member['guild_joined_on'],'activities':activities,'points':{'prime_present':150,'prime_total':300,'mini_present':150,'mini_total':300},'allocation_weights':{'prime':300,'mini':600},'cash':{'prime':'200000','mini':'400000'}}
  elif path.endswith('/rpc/set_guild_join_date'):calls.append(('date',p));member['guild_joined_on']=p['p_date'];member['guild_join_version']+=1;state['version']+=1;data=None
  elif path.endswith('/rpc/salary_change_history'):
   data={'entries':[{'id':'100','at':start,'action':'salary.calculation_changed','actor':'Администратор','target':member['nickname'],'reason':'Исправление состава','deferred':True,'changes':[{'member_id':MEMBER,'nickname':member['nickname'],'prime_before':'100000','prime_after':'150000','mini_before':'200000','mini_after':'250000','prime_percent_before':50,'prime_percent_after':60,'mini_percent_before':50,'mini_percent_after':60}]},{'id':'99','at':start,'action':'salary.statement_completed','actor':'Администратор','statement_id':STATEMENT}], 'next_before':None}
  elif path.endswith('/rpc/salary_statement_report'):data={'status':'completed' if state['closed'] else 'locked','created_at':start,'closed_at':start if state['closed'] else None,'creator':'Администратор','closer':'Администратор','reason':None,'rows':[snapshot or row()]}
  else:return super().reply()
  encoded=json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(encoded)));self.end_headers();self.wfile.write(encoded)
fixture=ThreadingHTTPServer(('127.0.0.1',0),StatementFixture);Thread(target=fixture.serve_forever,daemon=True).start()
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
origin=f'http://127.0.0.1:{port}';env={**os.environ,'NEXT_PUBLIC_SUPABASE_URL':f'http://127.0.0.1:{fixture.server_port}','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':'fixture-key','APP_ORIGIN':origin}
access=b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':USER,'aud':'authenticated','role':'authenticated','exp':int(now)+3600})+'.c2lnbmF0dXJl';cookie='base64-'+b64({'access_token':access,'refresh_token':'fixture-refresh','token_type':'bearer','expires_at':int(now)+3600,'user':{'id':USER,'aud':'authenticated','role':'authenticated','email':'fixture@example.test'}})
artifacts=Path('/workspace/artifacts/salary-statements');artifacts.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryFile() as log:
 server=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',str(port)],cwd=ROOT,env=env,stdout=log,stderr=log)
 try:
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox']);context=browser.new_context(locale='ru-RU',reduced_motion='reduce');context.add_cookies([{'name':'sb-127-auth-token','value':cookie,'url':origin}]);page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   for attempt in range(100):
    try:page.goto(origin+'/login');break
    except Exception:time.sleep(.1)
   for width in [390,1440]:
    state.update(locked=False,closed=False,paid_prime=False,paid_mini=False,version=1,bonus=0,staff=True);snapshot=None
    page.set_viewport_size({'width':width,'height':1000});page.goto(origin+'/payments/salary',wait_until='networkidle')
    expect(page.get_by_role('heading',name='Расчёт открыт',exact=True)).to_be_visible()
    lock=page.locator('form').filter(has=page.get_by_role('button',name='Зафиксировать ведомость',exact=True));lock.locator('input[name=confirm]').check();lock.get_by_role('button').click()
    expect(page.get_by_role('heading',name='Ведомость зафиксирована',exact=True)).to_be_visible();assert not state['paid_prime'] and not state['paid_mini']
    complete=page.locator('form').filter(has=page.get_by_role('button',name='Завершить ведомость',exact=True));complete.locator('input[name=confirm]').check();complete.get_by_role('button').click();expect(complete.get_by_role('alert')).to_contain_text('невыплаченные')
    page.get_by_role('button',name='Выплата Прайм',exact=True).click();expect(page.get_by_role('group',name=member['nickname']+' · Прайм',exact=True).get_by_text('Выплачено',exact=True)).to_be_visible()
    state['bonus']=50000;page.reload(wait_until='networkidle');expect(page.get_by_role('group',name=member['nickname']+' · Мини РБ',exact=True).get_by_text('20 зол.',exact=True)).to_be_visible()
    page.evaluate('window.scrollTo(0,0)');page.screenshot(path=str(artifacts/f'locked-{width}.png'),full_page=True)
    page.goto(origin+'/members',wait_until='networkidle');expect(page.get_by_text('Посещаемость показана по текущим активностям.',exact=False)).to_be_visible();expect(page.get_by_role('progressbar',name='Посещаемость: Прайм',exact=True)).to_have_attribute('aria-valuenow','100');page.goto(origin+'/payments/salary',wait_until='networkidle')
    page.get_by_role('button',name='Выплата Мини РБ',exact=True).click();complete=page.locator('form').filter(has=page.get_by_role('button',name='Завершить ведомость',exact=True));complete.locator('input[name=confirm]').check();complete.get_by_role('button').click();expect(page.get_by_role('heading',name='Расчёт открыт',exact=True)).to_be_visible()
    expect(page.get_by_role('group',name=member['nickname']+' · Прайм',exact=True).get_by_text('5 зол.',exact=True)).to_be_visible()
    page.get_by_role('link',name=member['nickname'],exact=True).click();expect(page.get_by_role('heading',name='Как получилась сумма',exact=True)).to_be_visible();expect(page.get_by_role('heading',name='Учтённые активности · 6',exact=True)).to_be_visible();expect(page.get_by_role('region',name='Учтённые активности').locator('tbody tr')).to_have_count(6)
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
    page.evaluate('window.scrollTo(0,0)');page.screenshot(path=str(artifacts/f'explanation-{width}.png'),full_page=True)
    page.goto(origin+'/members/'+MEMBER,wait_until='networkidle');date=page.locator('form').filter(has=page.get_by_role('button',name='Сохранить дату вступления',exact=True));date.get_by_label('Дата вступления',exact=True).fill('2026-10-20');date.get_by_label('Причина изменения',exact=True).fill('Проверенная дата вступления');date.get_by_role('button').click();expect(date.get_by_role('status')).to_contain_text('Дата вступления сохранена');assert calls[-1][1]['p_date']=='2026-10-20'
    page.goto(origin+'/payments/history',wait_until='networkidle');page.get_by_text('Изменение зарплаты',exact=False).click();expect(page.get_by_text('10 → 15 зол.',exact=False)).to_be_visible();page.screenshot(path=str(artifacts/f'history-{width}.png'),full_page=True)
    page.get_by_role('link',name='Открыть ведомость',exact=False).click();expect(page.get_by_role('heading',name='Зафиксированная ведомость',exact=True)).to_be_visible();expect(page.get_by_role('region',name='Сохранённая ведомость').get_by_text('10 зол.',exact=True)).to_be_visible();assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
    page.goto(origin+'/payments/salary',wait_until='networkidle');lock=page.locator('form').filter(has=page.get_by_role('button',name='Зафиксировать ведомость',exact=True));lock.locator('input[name=confirm]').check();lock.get_by_role('button').click();page.get_by_text('Снять фиксацию для исправления',exact=True).click();cancel=page.locator('form').filter(has=page.get_by_role('button',name='Снять фиксацию',exact=True));cancel.get_by_label('Причина',exact=True).fill('Уточнение открытого расчёта');cancel.locator('input[name=confirm]').check();cancel.get_by_role('button').click();expect(page.get_by_role('heading',name='Расчёт открыт',exact=True)).to_be_visible();assert state['paid_prime'] and state['paid_mini']
   state['staff']=False;page.goto(origin+'/payments/history',wait_until='networkidle');page.wait_for_url('**/dashboard?notice=forbidden',wait_until='networkidle');page.goto(origin+'/payments/salary/'+MEMBER,wait_until='networkidle');expect(page.get_by_role('heading',name='Как получилась сумма',exact=True)).to_be_visible()
   assert not errors,errors;browser.close();print('PASS: mobile/desktop lock without paying, unpaid completion rejection, separate actual payouts, deferred income, completion/new calculation, own explanation, guild join editing, before/after history, immutable statement view and member permissions; isolated fixtures only')
 finally:server.terminate();server.wait(timeout=15);fixture.shutdown()
