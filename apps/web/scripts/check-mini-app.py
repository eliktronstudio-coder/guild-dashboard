"""Offline production Mini App checks. Run after npm run build.
The Next app and its HMAC verifier are real; Supabase and Telegram SDK are local fixtures.
No external fetches, real tokens or guild data. --browser additionally needs local Playwright/Chromium.
"""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from threading import Thread
from pathlib import Path
from contextlib import contextmanager
import subprocess, os, time, json, http.client, hashlib, hmac, socket, tempfile, urllib.parse, sys
ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://xd.example'
TOKEN = '123456:FAKE_TOKEN_FOR_LOCAL_TEST_ONLY_123456'
mode = 'ready'
calls = []
def credentials(user=201, age=0):
 fields={'auth_date':str(int(time.time())-age),'user':json.dumps({'id':user,'first_name':'Untrusted display name'},separators=(',',':')),'query_id':'local-fixture'}
 key=hmac.new(b'WebAppData',TOKEN.encode(),hashlib.sha256).digest()
 fields['hash']=hmac.new(key,'\n'.join(k+'='+fields[k] for k in sorted(fields)).encode(),hashlib.sha256).hexdigest()
 return urllib.parse.urlencode(fields)
def fixture(body):
 if mode=='blocked':return {'error':'forbidden'}
 if mode=='rate':return {'error':'rate_limited'}
 empty=mode=='empty'
 return {'nickname':'Лиса · тестовый участник' if body.get('p_telegram')=='201' else 'Ронин · тестовый участник',
  'period':body.get('p_period'),'stats':{'period_from':'2026-11-01','period_through':'2026-11-02',
  'present':0 if empty else 2,'applicable':0 if empty else 3,'percentage':None if empty else 66.7,
  'earned_units':'0' if empty else '700000003','paid_units':'0' if empty else '100000001','pending_units':'0' if empty else '799999997'},
  'events':[] if empty else [{'id':'50000000-0000-4000-8000-000000000001','title':'Прайм у восточной гавани · тест','starts_at':'2099-01-01T18:00:00Z','signed_up':True}]}
class Stub(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  body=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or '{}');calls.append((self.path,body))
  self.send_response(503 if mode=='error' else 200);self.send_header('Content-Type','application/json');self.end_headers()
  self.wfile.write(json.dumps({'message':'fixture unavailable'} if mode=='error' else ({'ok':True} if self.path.endswith('/telegram_mini_app_signup') else fixture(body))).encode())
@contextmanager
def running(enabled=True):
 stub=ThreadingHTTPServer(('127.0.0.1',0),Stub);Thread(target=stub.serve_forever,daemon=True).start()
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 stub_origin='http://127.0.0.1:'+str(stub.server_address[1])
 with tempfile.TemporaryDirectory(prefix='xd-mini-http-') as tmp:
  guard=Path(tmp)/'offline.cjs'
  guard.write_text("const original=globalThis.fetch;globalThis.fetch=(input,init)=>{const u=new URL(typeof input==='string'?input:input.url??String(input));if(u.origin!=="+json.dumps(stub_origin)+")throw Error('External fetch blocked in offline Mini App check');return original(input,init)};")
  env=os.environ.copy();env.update(NEXT_PUBLIC_SUPABASE_URL=stub_origin,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='fixture_public_key',SUPABASE_SECRET_KEY='fixture_server_key',APP_ORIGIN=ORIGIN,TELEGRAM_BOT_ENABLED='true',TELEGRAM_BOT_USERNAME='XD_bot',TELEGRAM_BOT_TOKEN=TOKEN,TELEGRAM_WEBHOOK_SECRET='fixture_'+'w'*32,TELEGRAM_MINI_APP_ENABLED='true' if enabled else 'false')
  env['NODE_OPTIONS']=env.get('NODE_OPTIONS','')+' --require '+str(guard)
  with open(Path(tmp)/'server.log','w') as log:
   server=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',str(port)],cwd=ROOT,env=env,stdout=log,stderr=log)
   def request(path='/api/telegram/mini-app',method='POST',data=None,headers=None):
    c=http.client.HTTPConnection('127.0.0.1',port,timeout=15);c.request(method,path,json.dumps(data) if data is not None else '',headers or {})
    r=c.getresponse();value=(r.status,{k.lower():v for k,v in r.getheaders()},r.read());c.close();return value
   try:
    for _ in range(100):
     try:request('/mini-app','GET');break
     except OSError:time.sleep(.1)
    else:raise AssertionError('Production server did not start')
    yield request,port
   finally:server.terminate();server.wait(timeout=10);stub.shutdown()

def http_checks():
 global mode
 with running() as (request,port):
  headers={'origin':ORIGIN,'content-type':'application/json'}
  payload={'initData':credentials(),'period':'month'}
  calls.clear()
  assert request(data=payload)[0]==403
  assert request(data=payload,headers={**headers,'origin':'https://evil.example'})[0]==403
  assert request(data={'initData':credentials()+'tampered','period':'month'},headers=headers)[0]==401
  assert request(data={'initData':credentials(age=301),'period':'month'},headers=headers)[0]==401
  for invalid in [{**payload,'member_id':'someone'}, {**payload,'period':['week']}, {**payload,'period':'season'}, {'x':'a'*17000}]:
   assert request(data=invalid,headers=headers)[0]==400
  assert not calls
  status,response_headers,body=request(data=payload,headers=headers)
  assert status==200 and json.loads(body)['nickname'].startswith('Лиса')
  assert json.loads(body)['expires_at']<=int(time.time())+300
  assert response_headers['cache-control']=='private, no-store' and 'set-cookie' not in response_headers
  assert calls[-1][0].endswith('/telegram_mini_app_report') and calls[-1][1]=={'p_telegram':'201','p_period':'month'}
  assert payload['initData'] not in json.dumps(calls)
  for period in ['week','month']:
   assert request(data={'initData':credentials(301),'period':period},headers=headers)[0]==200
   assert calls[-1][1]=={'p_telegram':'301','p_period':period}
  signup={**payload,'event':'50000000-0000-4000-8000-000000000001','join':True,'request':'60000000-0000-4000-8000-000000000001'}
  assert request(data=signup,headers=headers)[0]==200
  assert calls[-1][0].endswith('/telegram_mini_app_signup')
  assert calls[-1][1]['p_telegram']=='201' and calls[-1][1]['p_join'] is True and isinstance(calls[-1][1]['p_auth_date'],int)
  assert request(data={**signup,'join':'true'},headers=headers)[0]==400
  for state,code in [('blocked',403),('rate',429),('error',503)]:
   mode=state;status,response_headers,body=request(data=payload,headers=headers);assert status==code
   if state=='rate':assert response_headers['retry-after']=='60'
  mode='ready'
  status,h,body=request('/mini-app','GET');assert status==200
  assert 'x-frame-options' not in h and "frame-ancestors https://web.telegram.org;" in h['content-security-policy']
  assert h['referrer-policy']=='no-referrer'
  for path in ['/login','/mini-app/other','/api/telegram/mini-app']:
   _,h,_=request(path,'GET');assert h['x-frame-options']=='DENY' and "frame-ancestors 'none'" in h['content-security-policy']
 with running(False) as (request,port):
  assert request(data=payload,headers=headers)[0]==503
  assert 'ещё не подключено' in request('/mini-app','GET')[2].decode()
 print('PASS: Mini App production HTTP: HMAC, TTL, origin, strict body, own verified ID, no cookies/cache, errors, rate limit, frame policy and disabled feature. Database is a local fixture; no external calls.')

def browser_checks():
 global mode
 from playwright.sync_api import sync_playwright
 shots=Path('/tmp/xd-mini-screenshots');shots.mkdir(exist_ok=True)
 with running() as (request,port), sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  count=0
  for width in [320,390,768,1440]:
   for state in ['ready','empty','blocked','rate','error','outside','expired','sdk_error']:
    mode=state if state in ['ready','empty','blocked','rate','error'] else 'ready'
    page=browser.new_page(viewport={'width':width,'height':900},locale='ru-RU',reduced_motion='reduce')
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    proof='' if state=='outside' else credentials(age=301 if state=='expired' else 0)
    def routing(route):
     u=urllib.parse.urlsplit(route.request.url)
     if u.hostname=='telegram.org':
      if state=='sdk_error':route.abort();return
      route.fulfill(status=200,content_type='application/javascript',body='window.Telegram={WebApp:{initData:'+json.dumps(proof)+',ready(){},expand(){}}};');return
     if u.hostname=='xd.example':
      response=route.fetch(url='http://127.0.0.1:'+str(port)+u.path+('?' + u.query if u.query else ''))
      route.fulfill(response=response);return
     route.abort()
    page.route('**/*',routing)
    page.goto(ORIGIN+'/mini-app');page.get_by_role('heading',name='Мой кабинет').wait_for()
    if state in ['ready','empty']:
     page.get_by_role('heading',name='Моё золото').wait_for()
     assert page.get_by_text('Лиса · тестовый участник',exact=True).count()==1
     if state=='empty':assert page.get_by_text('Нет данных',exact=True).count()==1
     else:
      page.get_by_role('button',name='Неделя',exact=True).click();page.get_by_role('heading',name='Моё золото').wait_for()
      assert calls[-1][1]['p_period']=='week'
      page.get_by_role('button',name='Обновить данные',exact=True).click();page.get_by_role('heading',name='Моё золото').wait_for()
    elif state=='outside':page.get_by_role('heading',name='Кабинет внутри Telegram').wait_for()
    else:
     page.get_by_role('heading',name='Кабинет пока недоступен').wait_for()
     assert page.get_by_role('heading',name='Моё золото').count()==0
     if state=='error':
      mode='ready';page.get_by_role('button',name='Попробовать снова').click();page.get_by_role('heading',name='Моё золото').wait_for()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),(width,state,'horizontal overflow')
    assert not errors,(width,state,errors)
    assert page.evaluate('localStorage.length===0 && sessionStorage.length===0')
    if width in [390,1440] and state in ['ready','empty','expired']:
     page.evaluate("document.querySelector('.mini-heading').insertAdjacentHTML('afterbegin','<p style=\"color:#efce95;font-size:12px\">ЛОКАЛЬНЫЙ ТЕСТ · ДЕМОНСТРАЦИОННЫЕ ДАННЫЕ</p>')")
     page.screenshot(path=str(shots/f'mini-{state}-{width}.png'),full_page=True)
    if width==390 and state=='ready':
     page.get_by_role('button',name='Отменить запись',exact=True).click()
     page.get_by_role('heading',name='Моё золото').wait_for()
     assert any(path.endswith('/telegram_mini_app_signup') and body.get('p_join') is False for path,body in calls)

     page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))")
     page.get_by_role('heading',name='Моё золото').wait_for(state='hidden')
     mode='blocked'
     page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))")
     page.get_by_role('heading',name='Кабинет пока недоступен').wait_for()
     assert page.get_by_text('Лиса · тестовый участник',exact=True).count()==0
    page.close();count+=1
  browser.close()
 print(f'PASS: {count} production-browser width/state combinations, period switch, refresh, retry, hide/resume with revoked access, no overflow/JS errors/storage; signed SDK and database fixtures. Screenshots: {shots}')
if __name__=='__main__':
 http_checks()
 if '--browser' in sys.argv:browser_checks()
