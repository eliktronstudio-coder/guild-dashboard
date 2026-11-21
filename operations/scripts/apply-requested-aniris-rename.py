"""Apply the additive activity workspace schema to the verified live project."""
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

query("""begin;
set local statement_timeout='30s';set local lock_timeout='10s';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $rename$ declare g uuid:='00000000-0000-4000-8000-000000000001';actor uuid;target uuid;n integer;m public.memberships;begin
 perform 1 from public.guilds where id=g for update;
 select own.user_id into actor from public.discord_settings s join public.memberships own on own.id=s.import_membership_id join public.profiles p on p.id=own.user_id where s.guild_id=g and s.enabled and own.status='active' and not p.blocked;
 if actor is null then raise exception 'CONNECTION_OWNER_UNAVAILABLE';end if;
 perform set_config('xd.discord_actor',actor::text,true);
 if not public.has_permission(g,'members.manage') then raise exception 'FORBIDDEN';end if;
 select count(*),min(id::text)::uuid into n,target from public.memberships where guild_id=g and status='active' and nickname_key=private.nickname_key('Слакислаки');
 if n=0 then
  select count(distinct a.id),min(a.id::text)::uuid into n,target from public.memberships a join public.nickname_history h on h.membership_id=a.id and h.guild_id=a.guild_id where a.guild_id=g and a.status='active' and private.nickname_key(h.old_nickname)=private.nickname_key('Слакислаки');
 end if;
 if n<>1 then raise exception 'REQUESTED_RENAME_NOT_UNIQUE';end if;
 select * into m from public.memberships where id=target;
 perform public.change_member_nickname(m.id,m.profile_version,'Aniris','По запросу администратора: Слакислаки → Aniris');
 if not exists(select 1 from public.memberships where id=target and nickname='Aniris') then raise exception 'RENAME_NOT_SAVED';end if;
 perform set_config('xd.discord_actor','',true);
end $rename$;
commit;""")
print('REQUESTED_ANIRIS_RENAME_SAVED_SAME_MEMBER_ID',flush=True)
