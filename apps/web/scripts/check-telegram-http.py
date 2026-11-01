"""Offline production-handler smoke check. Run after npm run build.
Uses only loopback HTTP with synthetic settings; external fetches are blocked.
"""
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from threading import Thread
from pathlib import Path
import subprocess,os,time,json,http.client,hashlib,socket,tempfile
calls=[]; fail=False
class Stub(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  body=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or '{}');calls.append((self.path,body))
  self.send_response(503 if fail else 200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b'{"message":"fixture unavailable"}' if fail else b'null')
stub=ThreadingHTTPServer(('127.0.0.1',0),Stub);Thread(target=stub.serve_forever,daemon=True).start()
secret='fixture_webhook_'+'w'*32;cron='fixture_cron_'+'c'*32
root=Path(__file__).resolve().parents[1]
with socket.socket() as sock:
 sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
stub_origin='http://127.0.0.1:'+str(stub.server_address[1])
temporary=tempfile.TemporaryDirectory(prefix='xd-telegram-http-')
guard=Path(temporary.name)/'offline.cjs'
guard.write_text("const original=globalThis.fetch; globalThis.fetch=(input,init)=>{const u=new URL(typeof input==='string'?input:input.url??String(input));if(u.origin!=="+json.dumps(stub_origin)+")throw Error('Offline smoke blocks external requests; rebuild without real public configuration.');return original(input,init)};")
child_env=os.environ.copy();child_env.update(NEXT_PUBLIC_SUPABASE_URL=stub_origin,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='fixture_public_key',SUPABASE_SECRET_KEY='fixture_server_key',APP_ORIGIN='https://xd.example',TELEGRAM_BOT_ENABLED='true',TELEGRAM_BOT_USERNAME='XD_bot',TELEGRAM_BOT_TOKEN='123456:FAKE_TOKEN_FOR_LOCAL_TEST_ONLY_123456',TELEGRAM_WEBHOOK_SECRET=secret,CRON_SECRET=cron)
child_env['NODE_OPTIONS']=child_env.get('NODE_OPTIONS','')+' --require '+str(guard)
log=open(Path(temporary.name)/'server.log','w')
server=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',str(port)],cwd=root,env=child_env,stdout=log,stderr=log)
def request(path,method='POST',data=None,headers=None):
 c=http.client.HTTPConnection('127.0.0.1',port,timeout=10);c.request(method,path,json.dumps(data) if data is not None else '',headers or {});r=c.getresponse();body=r.read();status=r.status;c.close();return status,body
try:
 for _ in range(100):
  try:request('/api/telegram/webhook');break
  except OSError:time.sleep(.1)
 assert request('/api/telegram/webhook')[0]==401
 assert request('/api/telegram/webhook',headers={'x-telegram-bot-api-secret-token':'wrong'})[0]==401
 assert not calls
 headers={'x-telegram-bot-api-secret-token':secret,'content-type':'application/json'}
 assert request('/api/telegram/webhook',data={'x':'a'*70000},headers=headers)[0]==400
 group={'update_id':1,'message':{'date':int(time.time()),'from':{'id':101,'is_bot':False},'chat':{'id':-100,'type':'group'},'text':'/events'}}
 assert request('/api/telegram/webhook',data=group,headers=headers)[0]==200
 assert not calls
 private={'update_id':2,'message':{'date':int(time.time()),'from':{'id':101,'is_bot':False},'chat':{'id':101,'type':'private'},'text':'/start link_'+'a'*43}}
 status,body=request('/api/telegram/webhook',data=private,headers=headers)
 assert status==200
 for _ in range(30):
  if any('/claim_telegram_delivery' in p for p,b in calls):break
  time.sleep(.1)
 receive=[b for p,b in calls if p.endswith('/receive_telegram_update')]
 assert len(receive)==1 and receive[0]['p_hash']==hashlib.sha256(('a'*43).encode()).hexdigest()
 assert 'a'*43 not in json.dumps(receive)
 assert request('/api/telegram/dispatch','GET')[0]==401
 status,body=request('/api/telegram/dispatch','GET',headers={'authorization':'Bearer '+cron});assert status==200 and json.loads(body)['attempted']==0
 event_id='50000000-0000-4000-8000-000000000001'
 for update_id,text,command in [(10,'/join '+event_id,'join'),(11,'/start leave_'+event_id,'leave')]:
  payload={**private,'update_id':update_id,'message':{**private['message'],'text':text}}
  assert request('/api/telegram/webhook',data=payload,headers=headers)[0]==200
  body=[b for p,b in calls if p.endswith('/receive_telegram_update')][-1]
  assert body['p_event']==event_id and body['p_command']==command and body['p_telegram']=='101'
 for update_id,text,command in [(12,'/stats','stats_month'),(13,'/stats week','stats_week'),(14,'/start stats_month','stats_month')]:
  payload={**private,'update_id':update_id,'message':{**private['message'],'text':text}}
  assert request('/api/telegram/webhook',data=payload,headers=headers)[0]==200
  body=[b for p,b in calls if p.endswith('/receive_telegram_update')][-1]
  assert body['p_event'] is None and body['p_hash'] is None and body['p_command']==command and body['p_telegram']=='101'
 count=len([b for p,b in calls if p.endswith('/receive_telegram_update')])
 payload={**private,'update_id':15,'message':{**private['message'],'text':'/stats week 301'}}
 assert request('/api/telegram/webhook',data=payload,headers=headers)[0]==200
 assert len([b for p,b in calls if p.endswith('/receive_telegram_update')])==count
 fail=True
 assert request('/api/telegram/webhook',data={**private,'update_id':3},headers=headers)[0]==503
 print('PASS: real Next HTTP handlers: 401 guards, bounded body, group rejection, hash-only RPC, signup/statistics commands, after() queue attempt, bearer dispatch and retryable database failure. Supabase HTTP was a local stub; no Telegram send occurred.')
finally:
 server.terminate();server.wait(timeout=10);log.close();stub.shutdown();temporary.cleanup()
