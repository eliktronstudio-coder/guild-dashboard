"""Production Next UI against a local authenticated Supabase fixture; no real services."""
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from threading import Thread
from pathlib import Path
import base64,json,time,socket,tempfile,subprocess,os,shutil,urllib.parse
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
USER='11111111-1111-4111-8111-111111111111'
MEMBER='22222222-2222-4222-8222-222222222222'
EVENT='33333333-3333-4333-8333-333333333333'
GUILD='00000000-0000-4000-8000-000000000001'
now=time.time();start=time.strftime('%Y-%m-%dT12:00:00Z',time.gmtime(now-86400))
member={'id':MEMBER,'user_id':USER,'nickname':'Тестовый участник','status':'active','joined_at':'2024-01-01T00:00:00Z','avatar_style':'moon','player_class':'Маг','class_selected_at':'2026-11-11T00:00:00Z','payout_weight':100,'weight_version':1,'character_class':'Маг','main_character':'Тестовый персонаж','specialization':'Маг','game_server':'Тестовый','role_codes':['owner'],'role_names':['Владелец']}
event={'id':EVENT,'guild_id':GUILD,'title':'Разъярённый Левиафан','kind':'raid','starts_at':start,'status':'completed','counts_for_attendance':True,'attendance_finalized_at':start,'treasury_source':'prime','boss_name':'Разъярённый Левиафан','boss_weight':150}
personal={'allocated_units':'1000000','paid_units':'250000','pending_units':'750000'}
totals={key:'0' for key in ['prime_units','prime_gross_units','mini_units','guild_units','prime_reserved_units','mini_reserved_units','prime_free_units','mini_free_units','guild_expense_units','inventory_units','general_units','xd_units']}
totals.update({'prime_units':'70000000','mini_units':'10000000','guild_units':'30000000','inventory_units':'5000000','sales_count':1,'stock_count':0,'priced_count':0,'unpriced_count':0})
report={'members':1,'pending_applications':0,'active_members':1,'completed_events':1,'attendance':100,'own_attendance':100,'own_present':1,'own_finance':personal,'own_earned_units':'1000000','upcoming':[],'weeks':[{'from':start,'until':start,'active':1,'attendance':100}],'ranking':[{'membership_id':MEMBER,'nickname':member['nickname'],'present':1,'percentage':100}],'finance':{'current':totals,'sales_units':'100000000','reversed_units':'0','opening_units':'0','weeks':[{'from':start,'until':start,'sales_units':'100000000','reversed_units':'0','balance_units':'100000000'}]}}
drops={}
banners={}
class Fixture(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):self.reply()
 def do_POST(self):
  payload=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or '{}')
  if self.path.endswith('/rpc/save_drop_registry'):
   old=drops.get(payload['p_id'],{})
   drops[payload['p_id']]={'id':payload['p_id'],'name':payload['p_name'],'photo':payload['p_photo'] if payload['p_photo'] is not None else old.get('photo',''),'price_units':str(payload['p_price']),'version':old.get('version',0)+1}
  elif self.path.endswith('/rpc/delete_drop_registry'):drops.pop(payload['p_id'],None)
  elif self.path.endswith('/rpc/save_activity_banner'):
   old=banners.get(payload['p_id'],{})
   banners[payload['p_id']]={'id':payload['p_id'],'name':payload['p_name'],'photo':payload['p_photo'] if payload['p_photo'] is not None else old.get('photo',''),'weight':payload['p_weight'],'version':old.get('version',0)+1}
  elif self.path.endswith('/rpc/delete_activity_banner'):banners.pop(payload['p_id'],None)
  self.reply()
 def reply(self):
  path=urllib.parse.urlsplit(self.path).path
  data=[]
  if path=='/auth/v1/user':data={'id':USER,'aud':'authenticated','role':'authenticated','email':'fixture@example.test','app_metadata':{'provider':'email'},'user_metadata':{},'created_at':'2024-01-01T00:00:00Z'}
  elif path.endswith('/rpc/has_permission'):data=True
  elif path.endswith('/rpc/dashboard_report'):data=report
  elif path.endswith('/rpc/activity_journal'):data={'total':0,'page':1,'can_view_roster':True,'kpis':{'total':0,'average':None,'best':None,'cancelled':0},'rows':[]}
  elif path.endswith('/rpc/period_payroll_report'):data={'from':'2026-10-15','until':'2026-11-15','signature':'a'*32,'prime_units':'70000000','mini_units':'10000000','rows':[{'id':MEMBER,'nickname':member['nickname'],'status':'active','payout_weight':100,'available':'100','present':'100','percentage':100,'prime_percentage':100,'mini_percentage':None,'pvp_percentage':None,'eligible':True,'prime_projection':'70000000','mini_projection':'10000000','prime_fixed':'0','mini_fixed':'0','prime_paid':'0','mini_paid':'0'}]}
  elif path.endswith('/rpc/treasury_summary'):data=totals
  elif path.endswith('/rpc/my_treasury_summary'):data=personal
  elif path.endswith('/profiles'):data=[{'id':USER,'blocked':False}]
  elif path.endswith('/memberships') or path.endswith('/member_directory'):data=[member]
  elif path.endswith('/attendance'):data=[{'membership_id':MEMBER,'mark':'present','events':event}]
  elif path.endswith('/events'):data=[event]
  elif path.endswith('/guild_drop_registry'):data=list(drops.values())
  elif path.endswith('/guild_activity_banners'):data=list(banners.values())
  if path.endswith('/attendance') and 'boss_name' in urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get('select',[''])[0]:
   encoded=json.dumps({'code':'42703','message':'column events.boss_name does not exist'}).encode();self.send_response(400);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(encoded);return
  encoded=json.dumps(data).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(encoded)));self.send_header('Content-Range',f'0-{max(0,len(data)-1)}/{len(data)}' if isinstance(data,list) else '0-0/1');self.end_headers();self.wfile.write(encoded)
def b64(value):return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
fixture=ThreadingHTTPServer(('127.0.0.1',0),Fixture);Thread(target=fixture.serve_forever,daemon=True).start()
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
origin=f'http://127.0.0.1:{port}';env={**os.environ,'NEXT_PUBLIC_SUPABASE_URL':f'http://127.0.0.1:{fixture.server_port}','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':'fixture-key','APP_ORIGIN':origin}
access=b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':USER,'aud':'authenticated','role':'authenticated','exp':int(now)+3600})+'.c2lnbmF0dXJl'
cookie='base64-'+b64({'access_token':access,'refresh_token':'fixture-refresh','token_type':'bearer','expires_at':int(now)+3600,'user':{'id':USER,'aud':'authenticated','role':'authenticated','email':'fixture@example.test'}})
artifacts=Path('/workspace/xd-live-artifacts');artifacts.mkdir(exist_ok=True)
with tempfile.TemporaryFile() as log:
 server=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',str(port)],cwd=ROOT,env=env,stdout=log,stderr=log)
 try:
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox']);context=browser.new_context(locale='ru-RU',color_scheme='dark',reduced_motion='reduce');context.add_cookies([{'name':'sb-127-auth-token','value':cookie,'url':origin}]);page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   for attempt in range(100):
    try:page.goto(origin+'/login');break
    except Exception:time.sleep(.2)
   for theme in ['dark','light']:
    page.evaluate("theme=>{document.documentElement.dataset.theme=theme;localStorage.setItem('xd-theme',theme)}",theme)
    for width in [360,390,768,1024,1440,1920]:
     page.set_viewport_size({'width':width,'height':1000})
     for path in ['/dashboard','/statistics','/events','/members','/treasury','/admin/drops','/admin/activity-banners']:
      response=page.goto(origin+path,wait_until='networkidle');assert response and response.status==200,(path,response.status if response else None)
      assert '/login' not in page.url and '/setup' not in page.url,(path,page.url)
      assert not [text for text in page.get_by_role('alert').all_text_contents() if text.strip()],(path,page.get_by_role('alert').all_text_contents())
      assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),(theme,width,path,'overflow')
      if theme=='dark' and width==1440 and path in ['/dashboard','/statistics']:page.screenshot(path=str(artifacts/(path[1:]+'-1440.png')),full_page=True)
   page.goto(origin+'/admin/drops',wait_until='networkidle')
   page.get_by_text('Добавить дроп',exact=True).first.click()
   create=page.locator('form').filter(has=page.get_by_role('button',name='Добавить дроп'))
   create.get_by_label('Название дропа').fill('Тестовый клинок')
   create.get_by_label('Цена за единицу').fill('123,45')
   png=page.evaluate("()=>{const c=document.createElement('canvas');c.width=10;c.height=10;c.getContext('2d').fillRect(0,0,10,10);return c.toDataURL('image/png').split(',')[1]}")
   create.locator('input[type=file]').set_input_files({'name':'drop.png','mimeType':'image/png','buffer':base64.b64decode(png)})
   create.get_by_alt_text('Предпросмотр фото').wait_for()
   create.get_by_role('button',name='Добавить дроп').click()
   page.get_by_role('heading',name='Тестовый клинок',exact=True).wait_for()
   entry=page.locator('article').filter(has=page.get_by_role('heading',name='Тестовый клинок',exact=True))
   assert entry.get_by_role('img',name='Тестовый клинок').count()==1
   entry.get_by_text('Редактировать',exact=True).click()
   edit=entry.locator('form').filter(has=page.get_by_role('button',name='Сохранить',exact=True))
   edit.get_by_label('Название дропа').fill('Обновлённый клинок');edit.get_by_label('Цена за единицу').fill('999,99')
   edit.get_by_role('button',name='Сохранить',exact=True).click()
   page.get_by_role('heading',name='Обновлённый клинок',exact=True).wait_for()
   entry=page.locator('article').filter(has=page.get_by_role('heading',name='Обновлённый клинок',exact=True))
   entry.get_by_text('Удалить',exact=True).click()
   entry.get_by_label('Подтверждаю удаление').check();entry.get_by_role('button',name='Удалить дроп',exact=True).click()
   page.get_by_text('Реестр пуст. Добавьте первый дроп.',exact=True).wait_for()
   assert not drops
   page.goto(origin+'/admin/activity-banners',wait_until='networkidle')
   page.get_by_text('Добавить активность',exact=True).first.click()
   create=page.locator('form').filter(has=page.get_by_role('button',name='Добавить активность'))
   create.get_by_label('Название активности').fill('Кракен')
   create.get_by_label('Коэффициент активности').fill('1,5')
   create.locator('input[type=file]').set_input_files({'name':'banner.png','mimeType':'image/png','buffer':base64.b64decode(png)})
   create.get_by_alt_text('Предпросмотр фото').wait_for()
   create.get_by_role('button',name='Добавить активность').click()
   page.get_by_role('heading',name='Кракен',exact=True).wait_for()
   for width in [360,1440]:
    page.set_viewport_size({'width':width,'height':1000})
    for path in ['/admin/activity-banners','/events']:
     page.goto(origin+path,wait_until='networkidle')
     assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),(path,width,'populated banner overflow')
     if width==1440 and path=='/admin/activity-banners':page.screenshot(path=str(artifacts/'activity-banners-1440.png'),full_page=True)
   page.goto(origin+'/events/new?banner='+next(iter(banners)),wait_until='networkidle')
   expect(page.get_by_label('Название',exact=True)).to_have_value('Кракен')
   expect(page.get_by_label('Коэффициент',exact=True)).to_have_value('1.5')
   page.goto(origin+'/admin/activity-banners',wait_until='networkidle')
   entry=page.locator('article').filter(has=page.get_by_role('heading',name='Кракен',exact=True))
   entry.get_by_text('Редактировать',exact=True).click()
   edit=entry.locator('form').filter(has=page.get_by_role('button',name='Сохранить',exact=True))
   edit.get_by_label('Коэффициент активности').fill('2,5')
   edit.get_by_role('button',name='Сохранить',exact=True).click()
   page.get_by_text('2,5 ×',exact=True).wait_for()
   entry.get_by_text('Удалить',exact=True).click()
   entry.get_by_label('Подтверждаю удаление').check();entry.get_by_role('button',name='Удалить баннер',exact=True).click()
   page.get_by_text('Баннеров пока нет. Добавьте первую активность.',exact=True).wait_for()
   assert not banners
   assert not errors,errors[:3]
   page.goto(origin+'/dashboard',wait_until='networkidle');page.get_by_role('button',name='Настроить',exact=True).click();page.get_by_label('Видимость панелей').get_by_label('Динамика казны',exact=True).uncheck();page.reload(wait_until='networkidle');assert page.locator('[data-panel-id="treasury"]').count()==0
   page.goto(origin+'/statistics/export',wait_until='commit') if False else None
   response=context.request.get(origin+'/statistics/export');assert response.status==200 and 'Тестовый участник' in response.text()
   anonymous=browser.new_context();r=anonymous.request.get(origin+'/statistics',max_redirects=0);assert r.status in [200,303,307,308] and '/login' in r.text() and 'Тестовый участник' not in r.text()
   browser.close();print('PASS: real authenticated Supabase-shaped SSR, 7 sections × 6 widths × 2 themes, drop and activity banner CRUD, public banner and event selection, private access, CSV and saved panels; no real accounts or production data used',flush=True)
 finally:
  server.terminate();server.wait(timeout=15);fixture.shutdown()
