"""Verify or grant only the bot's required permissions in the requested rename channel."""
import os,subprocess
ssh=['ssh','-i',os.path.expanduser('~/.ssh/xd_operations'),'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','root@200.165.236.194']
code=r'''import {siteClient} from './src/site.mjs';
const site=siteClient(process.env.XD_SITE_ORIGIN??'https://xd-guild.ru',process.env.DISCORD_IMPORT_SECRET),c=await site('runtime');
if(!c.enabled)throw Error('DISCORD_DISABLED');
async function request(path,options={}){
 const r=await fetch('https://discord.com/api/v10'+path,{...options,headers:{Authorization:'Bot '+c.token,'Content-Type':'application/json','X-Audit-Log-Reason':'Enable requested nickname rename channel'},signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('DISCORD_ACCESS_HTTP_'+r.status);
 return r.status===204?null:r.json();
}
const me=await request('/users/@me');
const targetGuild='1168236346230439998';
const targetResponse=await fetch('https://discord.com/api/v10/guilds/'+targetGuild+'/members/'+me.id,{headers:{Authorization:'Bot '+c.token},signal:AbortSignal.timeout(20000)});
console.log('RENAME_SERVER_CHECK',JSON.stringify({configuredServerMatches:c.server===targetGuild,botPresent:targetResponse.ok,discordStatus:targetResponse.status,applicationId:me.id}));
if(c.server!==targetGuild)throw Error('RENAME_SERVER_DIFFERS_FROM_CONFIGURED_SERVER');
const channels=await request('/guilds/'+c.server+'/channels');
const ch=channels.find(x=>x.id==='1211335490024771674');
if(!ch){
 console.log('RENAME_CHANNEL_DIAGNOSTIC',JSON.stringify({requestedIsServer:c.server==='1211335490024771674',candidates:channels.filter(x=>/ренейм|rename/iu.test(x.name??'')).map(x=>({id:x.id,name:x.name})).slice(0,10)}));
 throw Error('RENAME_CHANNEL_NOT_ACCESSIBLE');
}
const member=await request('/guilds/'+c.server+'/members/'+me.id),roles=await request('/guilds/'+c.server+'/roles');
let perm=roles.filter(r=>r.id===c.server||member.roles.includes(r.id)).reduce((v,r)=>v|BigInt(r.permissions),0n);
const required=1024n|65536n|64n;
if(!(perm&8n)){
 const rows=ch.permission_overwrites??[],apply=o=>{if(o)perm=(perm&~BigInt(o.deny))|BigInt(o.allow);};
 apply(rows.find(x=>x.id===c.server));
 const group=rows.filter(x=>x.type===0&&member.roles.includes(x.id));
 perm=(perm&~group.reduce((v,r)=>v|BigInt(r.deny),0n))|group.reduce((v,r)=>v|BigInt(r.allow),0n);
 const self=rows.find(x=>x.type===1&&x.id===me.id);apply(self);
 console.log('DISCORD_RENAME_PERMISSION_CHECK',JSON.stringify({view:!!(perm&1024n),history:!!(perm&65536n),reactions:!!(perm&64n),manageRoles:!!(perm&268435456n)}));
 if((perm&required)!==required){
  if(!(perm&268435456n))throw Error('ADMIN_MUST_GRANT_RENAME_CHANNEL_ACCESS');
  await request('/channels/'+ch.id+'/permissions/'+me.id,{method:'PUT',body:JSON.stringify({type:1,allow:String(BigInt(self?.allow??0)|required),deny:String(BigInt(self?.deny??0)&~required)})});
 }
}
await request('/channels/'+ch.id);await request('/channels/'+ch.id+'/messages?limit=1');
console.log('DISCORD_RENAME_CHANNEL_ACCESS_VERIFIED');
'''
launch='cd /var/www/xd-discord-bot/current; set -a; . /etc/xd-discord-bot.env; set +a; node --input-type=module -'
subprocess.run(ssh+[launch],input=code,text=True,timeout=120,check=True)
