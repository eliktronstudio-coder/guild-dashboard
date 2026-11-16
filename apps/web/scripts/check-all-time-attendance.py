"""All-time attendance across period boundaries against isolated fixtures; never touches production."""
from pathlib import Path
exec(compile(Path(__file__).with_name('check-command-center.py').read_text().split('fixture=ThreadingHTTPServer')[0],__file__,'exec'))
queries=[]
data_queries=[]
selected='2026-09-15'
raid=[{**event,'id':f'10000000-0000-4000-8000-{i:012d}','title':'АГЛ','activity_banner_name':'АГЛ','treasury_source':'mini_rb','activity_weight':100,'starts_at':f'2026-10-{20+i:02d}T12:00:00Z','status':'completed','counts_for_attendance':True,'inventory_receipt':False,'deleted_at':None} for i in range(10)]
class ArchiveFixture(Fixture):
 def do_POST(self):
  self.payload=json.loads(self.rfile.read(int(self.headers.get("Content-Length","0"))) or "{}")
  self.reply()
 def reply(self):
  path=urllib.parse.urlsplit(self.path).path;p=getattr(self,'payload',{});data_queries.append(path)
  data=None
  if path.endswith('/events'):data=raid
  elif path.endswith('/attendance'):data=[{'membership_id':MEMBER,'mark':'present','events':e} for e in raid[:5]]
  elif path.endswith('/rpc/command_attendance_data'):data={'events':raid,'members':[member],'marks':[{'event_id':e['id'],'membership_id':MEMBER,'mark':'present'} for e in raid[:5]]}
  elif path.endswith('/rpc/dashboard_report'):
   queries.append(p);data={**report,'finance':{**report['finance'],'current':{**totals,'prime_units':'0','mini_units':'0','guild_units':'0'}}}
  elif path.endswith('/rpc/treasury_summary'):data={**totals,'prime_units':'0','mini_units':'0','guild_units':'0'}
  elif path.endswith('/rpc/treasury_lifetime_summary'):data=totals
  elif path.endswith('/rpc/all_time_attendance_report'):
   data=[{'id':MEMBER,'nickname':member['nickname'],'status':'active','percentage':50,'prime_percentage':0,'mini_percentage':50,'pvp_percentage':0,'attendance_total':10,'attendance_present':5,'prime_total':0,'prime_present':0,'mini_total':10,'mini_present':5,'pvp_total':0,'pvp_present':0,'excused':0,'excluded':0,'absent':5,'eligible':True}]
  elif path.endswith(('/rpc/period_payroll_report','/rpc/lifetime_payroll_report')):
   old=path.endswith('/lifetime_payroll_report') or p.get('p_from')=='2026-10-15';t=10 if old else 0;n=5 if old else 0
   data={'scope':'lifetime','from':p.get('p_from','2026-10-15'),'until':'2026-12-15','prime_units':'0','mini_units':'0','signature':'a'*32,'rows':[{'id':MEMBER,'nickname':member['nickname'],'status':'active','payout_weight':100,'available':str(t),'present':str(n),'percentage':50 if old else 0,'prime_percentage':0,'mini_percentage':50 if old else 0,'pvp_percentage':0,'eligible':old,'prime_projection':'0','mini_projection':'0','prime_fixed':'0','mini_fixed':'0','prime_paid':'0','mini_paid':'0'}]}
  else:return super().reply()
  encoded=json.dumps(data).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(encoded)));self.end_headers();self.wfile.write(encoded)
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
    page.set_viewport_size({'width':width,'height':1000})
    page.goto(origin+'/dashboard?period=current',wait_until='networkidle')
    expect(page.locator('.personal-attendance').get_by_text('50%',exact=True)).to_have_count(2)
    expect(page.locator('.command-stat').filter(has_text='Казна Прайма').locator('strong')).to_contain_text('7\u202f000')
    for route in ['/members','/attendance','/statistics?period=current']:
     page.goto(origin+route,wait_until='networkidle')
     expect(page.get_by_role('heading',name='Не удалось загрузить страницу',exact=True)).to_have_count(0)
     assert '50%' in page.locator('main').inner_text(),route
     assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),route
    page.goto(origin+'/rb-purchase',wait_until='networkidle')
    expect(page.get_by_text(member['nickname'],exact=False)).not_to_have_count(0)
    page.goto(origin+'/treasury',wait_until='networkidle')
    for index,amount in enumerate(['7\u202f000','1\u202f000','3\u202f000']):expect(page.locator('.treasury-total').nth(index).locator('strong')).to_contain_text(amount)
    expect(page.get_by_text('Вся история · остаток после выплат',exact=True)).to_be_visible()
   assert sum(path.endswith('/rpc/command_attendance_data') for path in data_queries)==4,data_queries
   assert not any(path.endswith('/attendance') for path in data_queries),data_queries
   assert queries and all(q['p_from']=='2026-10-20T00:00:00.000Z' for q in queries),queries
   assert not errors,errors
   browser.close();print('PASS: pre-15th 5/10=50% across dashboard, roster, statistics, attendance and Mini RB candidates despite empty current period; lifetime treasury remains nonzero despite empty period; 390/1440px; isolated fixtures')
 finally:server.terminate();server.wait(timeout=15);fixture.shutdown()
