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

revision=os.environ['XD_EXPECTED_BOT_REVISION']
assert re.fullmatch('[a-f0-9]{40}',revision)
remote_script=r'''import pathlib,time,subprocess
expected='EXPECTED'
for i in range(60):
 if all(pathlib.Path('/var/lib/'+x+'/deployed').read_text().strip()==expected for x in ['xd-guild-deploy','xd-discord-bot']):break
 if i%6==0:print('WAITING_RENAME_RELEASE',flush=True)
 time.sleep(10)
else:raise SystemExit('RENAME_RELEASE_NOT_DEPLOYED')
for unit in ['xd-guild','xd-discord-bot','xd-guild-deploy.timer']:subprocess.run(['systemctl','is-active','--quiet',unit],check=True)
print('DISCORD_RENAME_RELEASE_ACTIVE',flush=True)
'''.replace('EXPECTED',revision)
subprocess.run(SSH+['python3 -'],input=remote_script,text=True,timeout=660,check=True)
# Same membership ID and related records; normal member mutation retains history and audit.
query("""begin;
set local statement_timeout='30s';set local lock_timeout='10s';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $rename$ declare g uuid:='00000000-0000-4000-8000-000000000001';actor uuid;target uuid;n integer;m public.memberships;begin
 perform 1 from public.guilds where id=g for update;
 select own.user_id into actor from public.discord_settings s join public.memberships own on own.id=s.import_membership_id join public.profiles p on p.id=own.user_id where s.guild_id=g and s.enabled and own.status='active' and not p.blocked;
 if actor is null then raise exception 'CONNECTION_OWNER_UNAVAILABLE';end if;
 perform set_config('xd.discord_actor',actor::text,true);
 if not public.has_permission(g,'members.manage') then raise exception 'FORBIDDEN';end if;
 select count(*),min(id::text)::uuid into n,target from public.memberships where guild_id=g and status='active' and nickname_key=private.nickname_key('Стакистаки');
 if n=0 then
  select count(distinct a.id),min(a.id::text)::uuid into n,target from public.memberships a join public.nickname_history h on h.membership_id=a.id and h.guild_id=a.guild_id where a.guild_id=g and a.status='active' and private.nickname_key(h.old_nickname)=private.nickname_key('Стакистаки');
 end if;
 if n<>1 then raise exception 'REQUESTED_RENAME_NOT_UNIQUE';end if;
 select * into m from public.memberships where id=target;
 perform public.change_member_nickname(m.id,m.profile_version,'Мэт','По запросу администратора: Стакистаки → Мэт');
 if not exists(select 1 from public.memberships where id=target and nickname='Мэт') then raise exception 'RENAME_NOT_SAVED';end if;
 perform set_config('xd.discord_actor','',true);
end $rename$;
commit;""")
print('REQUESTED_RENAME_SAVED_SAME_MEMBER_ID',flush=True)
# Read only channel metadata and permissions. Never log bot tokens or message content.
code=r'''import {siteClient} from './src/site.mjs';
const site=siteClient(process.env.XD_SITE_ORIGIN??'https://xd-guild.ru',process.env.DISCORD_IMPORT_SECRET);
const c=await site('runtime');
if(!c.enabled)throw Error('DISCORD_DISABLED');
async function get(path){const r=await fetch('https://discord.com/api/v10'+path,{headers:{Authorization:'Bot '+c.token},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('DISCORD_CHANNEL_HTTP_'+r.status);return r.json();}
const me=await get('/users/@me'),ch=await get('/channels/1211335490024771674');
if(ch.guild_id!==c.server)throw Error('RENAME_CHANNEL_WRONG_GUILD');
const member=await get('/guilds/'+c.server+'/members/'+me.id),roles=await get('/guilds/'+c.server+'/roles');
let perm=roles.filter(r=>r.id===c.server||member.roles.includes(r.id)).reduce((v,r)=>v|BigInt(r.permissions),0n);
if(!(perm&8n)){
 const rows=ch.permission_overwrites??[];
 const apply=o=>{if(o)perm=(perm&~BigInt(o.deny))|BigInt(o.allow);};
 apply(rows.find(x=>x.id===c.server));
 const group=rows.filter(x=>x.type===0&&member.roles.includes(x.id));
 perm=(perm&~group.reduce((v,r)=>v|BigInt(r.deny),0n))|group.reduce((v,r)=>v|BigInt(r.allow),0n);
 apply(rows.find(x=>x.type===1&&x.id===me.id));
 const required=1024n|65536n|64n;
 if((perm&required)!==required)throw Error('RENAME_CHANNEL_PERMISSIONS_MISSING');
}
await get('/channels/'+ch.id+'/messages?limit=1');
console.log('DISCORD_RENAME_CHANNEL_ACCESS_VERIFIED');
'''
launch="cd /var/www/xd-discord-bot/current; set -a; . /etc/xd-discord-bot.env; set +a; node --input-type=module -"
subprocess.run(SSH+[launch],input=code,text=True,timeout=100,check=True)
