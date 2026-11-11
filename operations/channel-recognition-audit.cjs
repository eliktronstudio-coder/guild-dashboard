require('@next/env').loadEnvConfig(process.cwd());
(async()=>{
 if(process.env.APP_ORIGIN!=='https://xd-guild.ru')throw Error('Unexpected site');
 const r=await fetch(process.env.APP_ORIGIN+'/api/discord/runtime',{headers:{Authorization:'Bearer '+process.env.DISCORD_IMPORT_SECRET},signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('Runtime unavailable');const settings=await r.json();if(!settings.enabled)throw Error('Bot disabled');
 const headers={Authorization:'Bot '+settings.token};const id='1541844664129294439';
 const channelResponse=await fetch('https://discord.com/api/v10/channels/'+id,{headers,signal:AbortSignal.timeout(10000)});
 console.log('TARGET_CHANNEL_ACCESS',channelResponse.status);if(!channelResponse.ok)return;
 const channel=await channelResponse.json();console.log('TARGET_CHANNEL',JSON.stringify({id:channel.id,name:channel.name,type:channel.type,same_server:channel.guild_id===settings.server,currently_configured:settings.channel===channel.id}));
 if(channel.guild_id!==settings.server)throw Error('Different guild; stop before reading history');
 const history=await fetch('https://discord.com/api/v10/channels/'+id+'/messages?limit=100',{headers,signal:AbortSignal.timeout(10000)});
 console.log('CHANNEL_HISTORY_ACCESS',history.status);if(!history.ok)return;
 const messages=await history.json();const fs=require('node:fs');fs.writeFileSync('/root/xd-channel-recognition-audit.json',JSON.stringify({channel,messages}),{mode:0o600});
 const bots=new Map();
 for(const m of messages){if(!m.author?.bot)continue;const b=bots.get(m.author.id)??{id:m.author.id,name:m.author.username,count:0,examples:[]};b.count++;
 const text=[m.content,...(m.embeds??[]).flatMap(e=>[e.title,e.description,...(e.fields??[]).map(f=>f.name+' '+f.value)])].filter(Boolean).join('\n');
 const counts=[...text.matchAll(/(?:Распознано участников|Сопоставлено с сайтом|гостей|Не разобрано|участников|Участники|Состав)\s*[:(]\s*(\d+)/giu)].map(x=>({label:x[0].replace(/\d+$/,''),count:Number(x[1])}));
 if(b.examples.length<6)b.examples.push({id:m.id,date:m.timestamp,counts,files:(m.attachments??[]).length,embeds:(m.embeds??[]).length,model_mentions:[...new Set((text.match(/GPT[- \w.]*|OpenAI|Gemini|Tesseract|PaddleOCR|EasyOCR|Claude/gi)??[]))]});
 bots.set(m.author.id,b);}
 const targetMessages=messages.filter(m=>m.author?.id==='1541835111153143858');
 console.log('REFERENCE_BOT_DETAILS',JSON.stringify(targetMessages.slice(0,10).map(m=>({id:m.id,date:m.timestamp,excerpt:(m.content??'').slice(0,600).replace(/sk-ant-[A-Za-z0-9_-]+/g,'[REDACTED]').replace(/https?:\/\/\S+/g,'[URL]')}))));
 console.log('CHANNEL_BOT_HISTORY',JSON.stringify({messages:messages.length,bots:[...bots.values()],images:messages.flatMap(m=>(m.attachments??[]).filter(a=>a.content_type?.startsWith('image/')).map(a=>({message:m.id,width:a.width,height:a.height,bytes:a.size}))).slice(0,12)}));
})().catch(e=>{console.error('CHANNEL_AUDIT_FAILED',e.message);process.exitCode=1});
