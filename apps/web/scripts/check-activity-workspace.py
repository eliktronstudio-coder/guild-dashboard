"""Isolated production-Next browser acceptance for the activity journal."""
from pathlib import Path
exec(compile(Path(__file__).with_name('check-command-center.py').read_text().split('fixture=ThreadingHTTPServer')[0],__file__,'exec'))
import uuid,copy,math,re
from playwright.sync_api import expect
STAFF=True
PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII='
BANNER='44444444-4444-4444-8444-444444444444';DROP='55555555-5555-4555-8555-555555555555'
picture=Path('/workspace/xd-activity-import/normalized/12.png')
photo='data:image/png;base64,'+base64.b64encode(picture.read_bytes()).decode() if picture.exists() else PNG
banners[BANNER]={'id':BANNER,'name':'Левиафан','photo':photo,'weight':100,'version':1}
drops[DROP]={'id':DROP,'name':'Адамантовый коготь','photo':PNG,'price_units':'20000000','version':1}
people=[member]+[{**member,'id':str(uuid.uuid5(uuid.NAMESPACE_URL,'person'+str(i))),'user_id':str(uuid.uuid4()),'nickname':'Игрок '+str(i).zfill(2),'character_class':['Хил','Лучник','Маг','Милик','Танк'][i%5]} for i in range(2,31)]
events={};reports={};lots={};evidence={};last_payload={}
for i in range(16):
 id=EVENT if i==0 else str(uuid.uuid5(uuid.NAMESPACE_URL,'event'+str(i)))
 events[id]={**event,'id':id,'title':'Левиафан' if i==0 else ['АГЛ','Кракен','Анталлон'][i%3],'version':1,'description':'','activity_banner_id':BANNER,'activity_banner_name':'Левиафан','activity_banner_photo':photo,'activity_weight':100,'treasury_source':'prime'}
 reports[id]={'members':[m['id'] for m in people[:17+i%11]],'guests':[],'difficulty':'normal','night':False,'reward_units':'0','facts':{}}
def detail(id):
 e=events[id];r=reports[id];lo=[x for x in lots.values() if x['event_id']==id]
 state=e['status'] if e['status']!='completed' else 'completed' if e['attendance_finalized_at'] else 'unconfirmed'
 return {'event':{'id':id,'title':e['title'],'starts_at':e['starts_at'],'kind':e['kind'],'status':e['status'],'source':e['treasury_source'],'journal_status':state,'version':e['version'],'weight':e['activity_weight'],'banner':e['activity_banner_id'],'has_banner':True,'finalized':bool(e['attendance_finalized_at']),'description':e['description'],'counts':e['counts_for_attendance']},'report':{k:r[k] for k in ['difficulty','night','reward_units','guests','facts']},'can_view_roster':STAFF,'roster':[m for m in people if m['id'] in r['members']] if STAFF else [],'selected_members':r['members'] if STAFF else [],'participants':len(r['members']) if STAFF else None,'loot':lo,'loot_total_units':str(sum(int(x['unit_units'])*x['quantity'] for x in lo)),'unpriced_count':0,'evidence':[{'id':x['id'],'kind':x['kind']} for x in evidence.values() if x['event_id']==id and(STAFF or x['kind']=='loot')]}
class WorkspaceFixture(Fixture):
 def send(self,data,status=200):
  b=json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(b)));self.send_header('Content-Range',f'0-{max(0,len(data)-1)}/{len(data)}' if isinstance(data,list) else '0-0/1');self.end_headers();self.wfile.write(b)
 def add_lot(self,event_id,catalog,quantity,id):
  d=drops[catalog];lots[id]={'id':id,'event_id':event_id,'guild_id':GUILD,'name':d['name'],'quantity':quantity,'quantity_total':quantity,'remaining':quantity,'unit_units':d['price_units'],'total_units':str(int(d['price_units'])*quantity),'has_photo':True,'catalog_photo':d['photo'],'version':1,'has_history':False}
 def do_POST(self):
  global last_payload
  self.payload=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or '{}');p=self.payload;path=urllib.parse.urlsplit(self.path).path
  if path.endswith('/rpc/record_activity') or path.endswith('/rpc/save_activity_details'):
   r=p['p_payload'];last_payload=r;id=p.get('p_request',p.get('p_event'));b=banners.get(r.get('banner'),banners[BANNER]);old=events.get(id,{})
   events[id]={**event,**old,'id':id,'title':r['title'],'kind':r['kind'],'starts_at':r['starts_at'],'status':r['status'],'version':old.get('version',0)+1,'description':r['description'],'counts_for_attendance':r['counts'],'attendance_finalized_at':r['starts_at'] if r['confirm_roster'] else None,'treasury_source':r['source'],'activity_banner_id':b['id'],'activity_banner_name':b['name'],'activity_banner_photo':b['photo'],'activity_weight':r['weight']}
   reports[id]={'members':r.get('members',[]),'guests':r['guests'],'difficulty':r['difficulty'],'night':r['night'],'reward_units':r['reward_units'],'facts':r['facts']}
   for eid in r['remove_evidence']:evidence.pop(eid,None)
   for x in r['evidence']:evidence[x['id']]={**x,'event_id':id}
   for x in r['loot']:self.add_lot(id,x['id'],x['quantity'],x['request_id'])
  elif path.endswith('/rpc/add_activity_drop'):self.add_lot(p['p_event'],p['p_catalog'],p['p_quantity'],p['p_request'])
  elif path.endswith('/rpc/remove_activity_drop'):lots.pop(p['p_id'],None)
  elif path.endswith('/rpc/cancel_activity'):
   if any(l['event_id']==p['p_event'] for l in lots.values()):return self.send({'code':'P0001','message':'LOOT_HAS_HISTORY'},400)
   events[p['p_event']]['status']='cancelled';events[p['p_event']]['version']+=1
  self.reply()
 def reply(self):
  path=urllib.parse.urlsplit(self.path).path;q=urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query);p=getattr(self,'payload',{})
  def eq(k):return q.get(k,[''])[0].removeprefix('eq.')
  if path.endswith('/rpc/has_permission'):return self.send(STAFF or p.get('permission') in ['members.read','treasury.read'])
  if path.endswith('/rpc/activity_detail'):return self.send(detail(p['p_event']))
  if path.endswith('/rpc/activity_journal'):
   f=p.get('p_filters',{});rows=[]
   for e in events.values():
    d=detail(e['id']);r=reports[e['id']];status=d['event']['journal_status']
    if f.get('status') and status!=f['status']:continue
    if f.get('source') and e['treasury_source']!=f['source']:continue
    if f.get('banner') and e['activity_banner_id']!=f['banner']:continue
    if f.get('player') and not any(f['player'].casefold() in m['nickname'].casefold() for m in people if m['id'] in r['members']):continue
    rows.append({'id':e['id'],'title':e['title'],'kind':e['kind'],'starts_at':e['starts_at'],'status':e['status'],'treasury_source':e['treasury_source'],'version':e['version'],'difficulty':r['difficulty'],'is_night':r['night'],'has_banner':True,'participants':d['participants'],'percentage':round(len(r['members'])/len(people)*100,1) if e['attendance_finalized_at'] and STAFF else None,'journal_status':status})
   pg=p.get('p_page',1);confirmed=[r['participants'] for r in rows if r['journal_status']=='completed' and STAFF]
   return self.send({'total':len(rows),'page':pg,'can_view_roster':STAFF,'kpis':{'total':len(rows),'average':round(sum(confirmed)/len(confirmed),1) if confirmed else None,'best':max(confirmed) if confirmed else None,'cancelled':sum(r['status']=='cancelled' for r in rows)},'rows':rows[(pg-1)*15:pg*15]})
  if path.endswith('/events'):return self.send([events[eq('id')]] if eq('id') in events else list(events.values()))
  if path.endswith('/memberships') or path.endswith('/member_directory'):return self.send([member] if q.get('user_id') else people)
  if path.endswith('/attendance') and 'events!inner' not in q.get('select',[''])[0]:return self.send([{'membership_id':m['id'],'mark':'present','version':1,'memberships':{'nickname':m['nickname'],'status':'active'}} for m in people if m['id'] in reports.get(eq('event_id'),{}).get('members',[])])
  if path.endswith('/activity_evidence'):return self.send([x for x in evidence.values() if(not eq('id') or x['id']==eq('id')) and(not eq('event_id') or x['event_id']==eq('event_id')) and(not eq('kind') or x['kind']==eq('kind'))])
  if path.endswith('/treasury_loot'):return self.send([x for x in lots.values() if(not eq('id') or x['id']==eq('id')) and(not eq('event_id') or x['event_id']==eq('event_id'))])
  if path.endswith('/rpc/record_activity'):return self.send(p['p_request'])
  if any(path.endswith('/rpc/'+n) for n in ['save_activity_details','add_activity_drop','remove_activity_drop','cancel_activity']):return self.send(None)
  super().reply()
fixture=ThreadingHTTPServer(('127.0.0.1',0),WorkspaceFixture);Thread(target=fixture.serve_forever,daemon=True).start()
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
origin=f'http://127.0.0.1:{port}';env={**os.environ,'NEXT_PUBLIC_SUPABASE_URL':f'http://127.0.0.1:{fixture.server_port}','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':'fixture-key','APP_ORIGIN':origin}
access=b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':USER,'aud':'authenticated','role':'authenticated','exp':int(now)+3600})+'.c2lnbmF0dXJl';cookie='base64-'+b64({'access_token':access,'refresh_token':'fixture-refresh','token_type':'bearer','expires_at':int(now)+3600,'user':{'id':USER,'aud':'authenticated','role':'authenticated','email':'fixture@example.test'}})
artifacts=Path('/workspace/xd-workspace-artifacts');artifacts.mkdir(exist_ok=True)
with tempfile.TemporaryFile() as log:
 server=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',str(port)],cwd=ROOT,env=env,stdout=log,stderr=log)
 try:
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox']);context=browser.new_context(locale='ru-RU',color_scheme='dark',reduced_motion='reduce');context.add_cookies([{'name':'sb-127-auth-token','value':cookie,'url':origin}]);page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   for attempt in range(100):
    try:page.goto(origin+'/login');break
    except Exception:time.sleep(.2)
   for theme in ['dark','light']:
    page.evaluate("t=>{document.documentElement.dataset.theme=t;localStorage.setItem('xd-theme',t)}",theme)
    for width in [360,390,768,1024,1440,1920]:
     page.set_viewport_size({'width':width,'height':1000})
     for path in ['/events','/events/new','/events/'+EVENT]:
      response=page.goto(origin+path,wait_until='networkidle');assert response and response.status==200,(path,response.status if response else None)
      if page.evaluate('document.documentElement.scrollWidth>innerWidth+1'):
       print('OVERFLOW',theme,width,path,page.evaluate("[...document.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,18).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right}))"),flush=True)
       page.screenshot(path=str(artifacts/'overflow.png'),full_page=True)
      assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),(theme,width,path,'overflow')
      assert not [t for t in page.get_by_role('alert').all_text_contents() if t.strip()],(path,page.get_by_role('alert').all_text_contents())
      if width in [390,1440] and theme=='dark':page.screenshot(path=str(artifacts/(path.replace('/','_')+f'-{width}.png')),full_page=True)
   print('PASS: journal/create/detail at 6 widths and 2 themes',flush=True)
   page.goto(origin+'/events',wait_until='networkidle');page.get_by_role('link',name='Далее →',exact=True).click();page.get_by_text('Страница 2 из 2',exact=True).wait_for()
   page.goto(origin+'/events/new?banner='+BANNER,wait_until='networkidle');expect(page.get_by_label('Название',exact=True)).to_have_value('Левиафан')
   page.get_by_label('Коэффициент',exact=True).fill('1,5');page.get_by_label('Золото за посещение — план',exact=True).fill('10,5');page.locator('#roster').get_by_label('Тестовый участник',exact=False).check();page.get_by_label('Подтверждаю состав:',exact=False).check();page.get_by_label('Ночная активность',exact=True).check()
   page.get_by_label('Имя незарегистрированного игрока').fill('Гость теста');page.get_by_role('button',name='Добавить',exact=True).click();page.get_by_label('Адамантовый коготь',exact=False).check();page.get_by_label('Количество',exact=True).fill('2')
   from PIL import Image
   import io
   image_buffer=io.BytesIO();Image.new('RGB',(32,24),'navy').save(image_buffer,format='PNG');raw=image_buffer.getvalue();page.get_by_label('Добавить скрины состава',exact=True).set_input_files({'name':'roster.png','mimeType':'image/png','buffer':raw});page.get_by_alt_text('Скрин состава 1',exact=True).wait_for();page.get_by_label('Добавить скрины дропа',exact=True).set_input_files({'name':'loot.png','mimeType':'image/png','buffer':raw});page.get_by_alt_text('Скрин дропа 1',exact=True).wait_for()
   page.get_by_text('Факты для достижений',exact=True).click();page.get_by_label('Босс побеждён',exact=True).check();page.get_by_label('Подтверждаю указанные факты',exact=True).check();page.get_by_role('button',name='Создать',exact=True).click();page.wait_for_url(re.compile(origin+r'/events/[0-9a-f-]{36}$'));created=page.url.rsplit('/',1)[-1];page.get_by_role('heading',name='Левиафан',exact=True,level=1).wait_for()
   assert last_payload['weight']==150 and last_payload['reward_units']=='105000' and last_payload['guests']==['Гость теста'];assert len(last_payload['evidence'])==2 and len(last_payload['loot'])==1;expect(page.locator('.activity-loot-card')).to_have_count(1);page.screenshot(path=str(artifacts/'created-detail-1920.png'),full_page=True)
   page.locator('.activity-hero-title').get_by_role('link',name='✎ Редактировать',exact=True).click();page.get_by_label('Коэффициент',exact=True).fill('0,75');page.get_by_label('Причина изменения',exact=True).fill('Исправление коэффициента');page.get_by_role('button',name='Сохранить',exact=True).click();page.wait_for_url(origin+'/events/'+created);assert last_payload['weight']==75
   page.get_by_text('＋ Добавить предмет',exact=True).click();page.get_by_label('Количество',exact=True).fill('3');page.get_by_role('button',name='Добавить предмет',exact=True).click();expect(page.locator('.activity-loot-card')).to_have_count(2)
   remove=page.locator('.activity-loot-card').last;remove.get_by_label('Удалить Адамантовый коготь',exact=True).click();remove.get_by_label('Причина',exact=True).fill('Ошибка количества');remove.get_by_label('Подтверждаю удаление',exact=True).check();remove.get_by_role('button',name='Удалить предмет',exact=True).click();expect(page.locator('.activity-loot-card')).to_have_count(1)
   page.goto(origin+'/events/'+EVENT+'/cancel',wait_until='networkidle');page.get_by_label('Причина',exact=True).fill('Перенос активности');page.get_by_label('Подтверждаю отмену',exact=True).check();page.get_by_role('button',name='Отменить активность',exact=True).click();page.wait_for_url(origin+'/events');assert events[EVENT]['status']=='cancelled'
   roster_id=next(x['id'] for x in evidence.values() if x['kind']=='roster');assert context.request.get(origin+f'/events/{created}/media?kind=roster&evidence={roster_id}').status==200
   STAFF=False;assert context.request.get(origin+f'/events/{created}/media?kind=roster&evidence={roster_id}').status==404
   anon=browser.new_context();r=anon.request.get(origin+'/events',max_redirects=0);assert '/login' in r.text() and 'Игрок 02' not in r.text();assert not errors,errors[:5];browser.close();print('PASS: Next server actions record roster/drop/guest/evidence/facts, edit, inventory add/remove, cancellation and private media; no real accounts or production data used',flush=True)
 finally:
  server.terminate();server.wait(timeout=15);fixture.shutdown()
