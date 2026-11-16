"""Salary payout UI against isolated fixtures; never touches production."""
from pathlib import Path
exec(compile(Path(__file__).with_name('check-command-center.py').read_text().split('fixture=ThreadingHTTPServer')[0],__file__,'exec'))
STAFF=True
paid={'prime':False,'mini_rb':False};version=1;fail_once=True;empty=False
OTHER='44444444-4444-4444-8444-444444444444';EXCLUDED='55555555-5555-4555-8555-555555555555'
def salary_row(id,nickname,eligible=True):
 return {'id':id,'nickname':nickname,'status':'active','payout_weight':100,'percentage':50 if eligible else 20,'prime_percentage':75,'mini_percentage':25,'pvp_percentage':0,'attendance_present':5 if eligible else 10,'attendance_total':10 if eligible else 51,'prime_present':3,'prime_total':4,'mini_present':1,'mini_total':4,'available':'1000','present':'500','eligible':eligible and not empty,'prime_projection':'0','mini_projection':'0','prime_fixed':'0','mini_fixed':'0','prime_paid':'0','mini_paid':'0'}
class ArchiveFixture(Fixture):
 def do_POST(self):
  self.payload=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or '{}');self.reply()
 def reply(self):
  global version,fail_once
  path=urllib.parse.urlsplit(self.path).path;p=getattr(self,'payload',{});status=200
  if path.endswith('/rpc/has_permission'):data=STAFF or p.get('permission') in ['members.read','treasury.read']
  elif path.endswith('/rpc/lifetime_payroll_report'):
   main=salary_row(MEMBER,member['nickname']);main.update({'prime_fixed':'0' if paid['prime'] else '140379294','mini_fixed':'0' if paid['mini_rb'] else '6337289','prime_paid':'140379294' if paid['prime'] else '0','mini_paid':'6337289' if paid['mini_rb'] else '0'})
   data={'scope':'lifetime','signature':f'{version:032x}','prime_units':'0','mini_units':'0','rows':[main,salary_row(OTHER,'Без начислений'),salary_row(EXCLUDED,'Ниже порога',False)]}
  elif path.endswith('/rpc/pay_lifetime_salary'):
   if fail_once:fail_once=False;status=400;data={'code':'P0001','message':'INSUFFICIENT_FUNDS'}
   elif p['p_signature']!=f'{version:032x}':status=400;data={'code':'P0001','message':'CALCULATION_CHANGED'}
   else:paid[p['p_source']]=True;version+=1;data=None
  else:return super().reply()
  encoded=json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(encoded)));self.end_headers();self.wfile.write(encoded)

fixture=ThreadingHTTPServer(('127.0.0.1',0),ArchiveFixture);Thread(target=fixture.serve_forever,daemon=True).start()
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
origin=f'http://127.0.0.1:{port}';env={**os.environ,'NEXT_PUBLIC_SUPABASE_URL':f'http://127.0.0.1:{fixture.server_port}','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':'fixture-key','APP_ORIGIN':origin}
access=b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':USER,'aud':'authenticated','role':'authenticated','exp':int(now)+3600})+'.c2lnbmF0dXJl';cookie='base64-'+b64({'access_token':access,'refresh_token':'fixture-refresh','token_type':'bearer','expires_at':int(now)+3600,'user':{'id':USER,'aud':'authenticated','role':'authenticated','email':'fixture@example.test'}})
artifacts=Path('/workspace/xd-salary-payment-artifacts');artifacts.mkdir(exist_ok=True)
with tempfile.TemporaryFile() as log:
 server=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',str(port)],cwd=ROOT,env=env,stdout=log,stderr=log)
 try:
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox']);context=browser.new_context(locale='ru-RU',reduced_motion='reduce');context.add_cookies([{'name':'sb-127-auth-token','value':cookie,'url':origin}]);page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   for i in range(100):
    try:page.goto(origin+'/login');break
    except Exception:time.sleep(.2)
   for width in [390,1440]:
    STAFF=True;paid={'prime':False,'mini_rb':False};version=1;fail_once=True;empty=False
    page.set_viewport_size({'width':width,'height':1000});page.goto(origin+'/payments',wait_until='networkidle')
    page.get_by_role('link',name='Выплата ЗП',exact=True).click();page.wait_for_url(origin+'/payments/salary',wait_until='networkidle')
    expect(page.locator('.salary-payout-table tbody tr')).to_have_count(2)
    page.screenshot(path=str(artifacts/f'salary-before-{width}.png'),full_page=True)
    expect(page.get_by_text('Ниже порога',exact=True)).to_have_count(0)
    expect(page.get_by_text('Прайм: 75% · 3/4',exact=True)).to_have_count(2)
    expect(page.get_by_text('Мини РБ: 25% · 1/4',exact=True)).to_have_count(2)
    expect(page.get_by_text('50% · 5/10',exact=True)).to_have_count(0)
    prime=page.get_by_role('group',name=member['nickname']+' · Прайм',exact=True)
    mini=page.get_by_role('group',name=member['nickname']+' · Мини РБ',exact=True)
    expect(prime.get_by_text('14\u202f038 зол.',exact=True)).to_be_visible()
    zero=page.get_by_role('group',name='Без начислений · Прайм',exact=True);expect(zero.get_by_text('Нет начислений',exact=True)).to_be_visible();expect(zero.locator('.badge.green')).to_have_count(0)
    prime.get_by_role('button',name='Выплата Прайм',exact=True).click();expect(prime.get_by_role('alert')).to_contain_text('недостаточно');expect(prime.locator('.badge.green')).to_have_count(0)
    prime.get_by_role('button',name='Выплата Прайм',exact=True).click();expect(prime.get_by_text('Выплачено',exact=True)).to_be_visible();expect(prime.get_by_text('14\u202f038 зол.',exact=True)).to_be_visible()
    expect(mini.get_by_role('button',name='Выплата Мини РБ',exact=True)).to_be_visible()
    mini.get_by_role('button',name='Выплата Мини РБ',exact=True).click();expect(mini.get_by_text('Выплачено',exact=True)).to_be_visible()
    page.reload(wait_until='networkidle');expect(page.locator('.salary-payout-table tbody tr').filter(has_text=member['nickname']).locator('.badge.green')).to_have_count(2)
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
    page.screenshot(path=str(artifacts/f'salary-paid-{width}.png'),full_page=True)
   page.evaluate("localStorage.setItem('xd-theme','light')");page.reload(wait_until='networkidle');page.screenshot(path=str(artifacts/'salary-paid-light-1440.png'),full_page=True)
   empty=True;page.goto(origin+'/payments/salary',wait_until='networkidle');expect(page.get_by_text('Пока нет участников с посещаемостью от 20%.',exact=True)).to_be_visible()
   STAFF=False;page.goto(origin+'/payments',wait_until='networkidle');expect(page.get_by_role('link',name='Выплата ЗП',exact=True)).to_have_count(0)
   page.goto(origin+'/payments/salary',wait_until='networkidle');page.wait_for_url('**/dashboard?notice=forbidden',wait_until='networkidle')
   assert not errors,errors
   browser.close();print('PASS: salary link, exact eligibility filtering, independent Prime/Mini controls, failed payment stays unpaid, successful paid check persists on reload with amount, zero/empty states and member denial; 390/1440px; isolated fixtures only')
 finally:server.terminate();server.wait(timeout=15);fixture.shutdown()
