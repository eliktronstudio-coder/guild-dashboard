require('@next/env').loadEnvConfig(process.cwd());
(async()=>{
 const {DatabaseSync}=require('node:sqlite'),crypto=require('node:crypto');
 const db=new DatabaseSync('/var/lib/xd-discord-bot/drafts.sqlite',{readOnly:true});
 const rows=db.prepare('select payload from drafts order by updated desc limit 3').all().map(r=>JSON.parse(r.payload)).filter(d=>d.attachments?.length);
 const runtime=await fetch('https://xd-guild.ru/api/discord/runtime',{headers:{Authorization:'Bearer '+process.env.DISCORD_IMPORT_SECRET}});if(!runtime.ok)throw Error('Runtime unavailable');const v=await runtime.json();
 const images=[],drafts=[];
 for(const d of rows.slice(0,2)){
  const r=await fetch('https://discord.com/api/v10/channels/'+d.context.channel+'/messages/'+d.message,{headers:{Authorization:'Bot '+v.token}});if(!r.ok)continue;const message=await r.json();
  for(const a of message.attachments.filter(a=>(d.rosterImages??[]).includes(a.id)).slice(0,2)){
   const u=new URL(a.url);if(u.protocol!=='https:'||!['cdn.discordapp.com','media.discordapp.net'].includes(u.hostname))throw Error('Invalid attachment');
   const res=await fetch(u,{redirect:'error'});if(!res.ok||Number(res.headers.get('content-length'))>12*1024*1024)continue;const data=Buffer.from(await res.arrayBuffer());if(data.length>12*1024*1024)continue;
   if(!images.some(i=>i.id===a.id))images.push({id:a.id,data:data.toString('base64')});
  }
  drafts.push({id:d.id,message:d.message,rosterImages:d.rosterImages,roster:d.roster,catalog:d.catalog.members});
 }
 db.close();
 const key=crypto.randomBytes(32),iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([c.update(JSON.stringify({drafts,images})),c.final()]);
 const wrapped=crypto.publicEncrypt({key:Buffer.from('LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUlJQklqQU5CZ2txaGtpRzl3MEJBUUVGQUFPQ0FROEFNSUlCQ2dLQ0FRRUFycndZOXpxenRIMVQvR1REWE1qWApYbXhkL2lteFBQcVhhelQzQktsYVZya1pIYk4xcldUTVRwSG5ZYmkrbFdjdmw0OExqbDhveXNsSFF1M2ZXU0U3Ci9NUldpVUpjZ1F1NEF2dkJId21NeXVoNm1FVVhWWXowYVhnRkRjMTh2OXR5dm1MYWxEaU41aVgwOEVYMDNhNDQKcUFMd3lYc2kyT1Mra2Z3Z2pIcWJCS0dUQkw3Q1A3SzIwMnpHL3U5UkRFcDFwS2lXaFJkZnRtSGFzMnYvTUFkYwpqVG1NeVA5c3d3ckhIWkNmUUh3L3FhMi84YTJuWjNZa2IydUd3RjVyNkFVWndxODY1MjlFdWprRXdacGdtYjhxCjRuL2t4OWhCL2puWExSWGxRM1NwVkcwL082YVd6SSt4U1ErOHZCUlNJWkZiYksvVFcrN21ieTlqQUVHZVFuMS8KNHdJREFRQUIKLS0tLS1FTkQgUFVCTElDIEtFWS0tLS0tCg==','base64'),oaepHash:'sha256',padding:crypto.constants.RSA_PKCS1_OAEP_PADDING},key);
 process.stdout.write(JSON.stringify({wrapped:wrapped.toString('base64'),iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),data:data.toString('base64')}));
})().catch(()=>{console.error('Private diagnostic export failed');process.exitCode=1});
