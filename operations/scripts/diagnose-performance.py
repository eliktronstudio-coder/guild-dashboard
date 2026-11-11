"""Inspect query plans using read-only transactions; never print account data."""
import os,json,re,subprocess,urllib.parse,urllib.request,urllib.error,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[2]
SSH=['ssh','-i',os.path.expanduser('~/.ssh/xd_operations'),'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=20','root@200.165.236.194']
remote='app=$(systemctl show xd-guild --property=WorkingDirectory --value); cd "$app"; node'
source="require('@next/env').loadEnvConfig(process.cwd());console.log(JSON.stringify({origin:process.env.APP_ORIGIN,url:process.env.NEXT_PUBLIC_SUPABASE_URL}));"
result=subprocess.run(SSH+[remote],input=source,text=True,capture_output=True,timeout=45,check=True)
target=json.loads(result.stdout);assert target['origin']=='https://xd-guild.ru'
url=urllib.parse.urlsplit(target['url']);ref=url.hostname.removesuffix('.supabase.co')
assert url.scheme=='https' and url.hostname.endswith('.supabase.co') and re.fullmatch('[a-z0-9]{20}',ref)
def query(sql):
 req=urllib.request.Request('https://api.supabase.com/v1/projects/'+ref+'/database/query',data=json.dumps({'query':sql}).encode(),headers={'Authorization':'Bearer '+os.environ['SUPABASE_ACCESS_TOKEN'],'Content-Type':'application/json'},method='POST')
 try:
  with urllib.request.urlopen(req,timeout=90) as response:return json.load(response)
 except urllib.error.HTTPError as e:
  print('SUPABASE_SQL_HTTP_ERROR',e.code,flush=True);raise SystemExit(1)

import time
for label,sql in [
 ('database_resources',"select datname,numbackends,deadlocks,temp_files from pg_stat_database where datname=current_database()"),
 ('active_query_summary',"select state,wait_event_type,count(*)::int count,max(extract(epoch from now()-query_start))::int oldest_seconds from pg_stat_activity where datname=current_database() group by state,wait_event_type"),
 ('table_sizes',"select relname,n_live_tup,n_dead_tup from pg_stat_user_tables where schemaname='public' order by n_live_tup desc limit 8"),
 ('statement_settings',"select rolname,rolconfig from pg_roles where rolname in ('authenticated','authenticator')"),
]:
 start=time.monotonic();rows=query(sql);print(label,json.dumps(rows),round((time.monotonic()-start)*1000),'ms',flush=True)
# Emulate a real existing owner session in a READ ONLY transaction. Return plans,
# not names, session identifiers, account data, or monetary values.
context="""begin read only;set local statement_timeout='12s';
select set_config('request.jwt.claims',(select jsonb_build_object('sub',m.user_id,'session_id',s.id)::text from public.memberships m join public.membership_roles mr on mr.membership_id=m.id join public.roles r on r.id=mr.role_id and r.code='owner' join auth.sessions s on s.user_id=m.user_id join public.profiles p on p.id=m.user_id and not p.blocked where m.status='active' and not exists(select 1 from public.revoked_sessions x where x.session_id=s.id) order by s.created_at desc limit 1),true);
set local role authenticated;
"""
probes={
 'own_profile':"select id,blocked from public.profiles where id=auth.uid()",
 'own_membership':"select id,nickname,status from public.memberships where user_id=auth.uid() and guild_id='00000000-0000-4000-8000-000000000001'",
 'permission':"select public.has_permission('00000000-0000-4000-8000-000000000001','treasury.read')",
 'directory':"select id,nickname from public.member_directory where guild_id='00000000-0000-4000-8000-000000000001' limit 100",
 'inventory_general':"select id,quantity_remaining,general_quantity from public.treasury_inventory where guild_id='00000000-0000-4000-8000-000000000001' and general_quantity>0 order by created_at desc limit 20",
 'attendance_page':"select a.membership_id,a.mark from public.attendance a join public.events e on e.id=a.event_id where a.guild_id='00000000-0000-4000-8000-000000000001' and e.starts_at>now()-interval '1 month' order by a.event_id,a.membership_id limit 500",
 'dashboard_report':"select public.dashboard_report((now()-interval '1 month'),now())",
}
for label,sql in probes.items():
 start=time.monotonic()
 try:
  rows=query(context+'explain (analyze,format json) '+sql+';rollback;')
  # Management API returns the final result; EXPLAIN output carries timings only.
  plans=[v for row in rows for v in row.values() if isinstance(v,list) and v and isinstance(v[0],dict) and 'Plan' in v[0]]
  print('AUTHENTICATED_PLAN',label,json.dumps([{'planning_ms':p[0].get('Planning Time'),'execution_ms':p[0].get('Execution Time'),'jit':p[0].get('JIT')} for p in plans]),round((time.monotonic()-start)*1000),'ms',flush=True)
 except BaseException as error:
  print('AUTHENTICATED_PLAN_FAILED',label,type(error).__name__,round((time.monotonic()-start)*1000),'ms',flush=True)


def nodes(plan):
 return [{'node':plan.get('Node Type'),'relation':plan.get('Relation Name'),'ms':plan.get('Actual Total Time'),'loops':plan.get('Actual Loops'),'rows':plan.get('Actual Rows')}]+[n for child in plan.get('Plans',[]) for n in nodes(child)]
for label,sql in {
 'viewer': 'select private.viewer_id()',
 'session': 'select private.session_user_id()',
 'session_lookup': "select u.id from auth.users u join auth.sessions s on s.user_id=u.id where u.id=auth.uid() and s.id::text=auth.jwt()->>'session_id' and (u.email_confirmed_at is not null or exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='custom:telegram')) and not exists(select 1 from public.revoked_sessions r where r.session_id=s.id)",
 'own_profile_plan':probes['own_profile'],
 'membership_plan':probes['own_membership'],
}.items():
 try:
  prefix=context if label!='session_lookup' else context.replace('set local role authenticated;','')
  rows=query(prefix+'explain (analyze,format json) '+sql+';rollback;')
  plans=[v for row in rows for v in row.values() if isinstance(v,list) and v and isinstance(v[0],dict) and 'Plan' in v[0]]
  print('PLAN_NODES',label,json.dumps([nodes(p[0]['Plan']) for p in plans]),flush=True)
 except BaseException as error:print('DETAIL_FAILED',label,type(error).__name__,flush=True)
