require('@next/env').loadEnvConfig(process.cwd());
(async()=>{
 if(process.env.APP_ORIGIN!=='https://xd-guild.ru')throw Error('Unexpected origin');
 const fs=require('node:fs'),log=fs.readFileSync('/tmp/xd-web-diagnostic.log','utf8');
 const patterns=['out of memory','OOM','fetch failed','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','ETIMEDOUT','statement timeout','PGRST','ECONNRESET','Failed to find Server Action'];
 console.log('WEB_LOG_ERROR_COUNTS',JSON.stringify(Object.fromEntries(patterns.map(p=>[p,log.split('\n').filter(l=>l.toLowerCase().includes(p.toLowerCase())).length]))));
 const origin=process.env.NEXT_PUBLIC_SUPABASE_URL,headers={apikey:process.env.SUPABASE_SECRET_KEY};
 for(const path of ['/rest/v1/profiles?select=id&limit=0','/rest/v1/memberships?select=id&limit=0','/rest/v1/treasury_inventory?select=id,general_quantity,xd_quantity&limit=0','/auth/v1/health']){
  const start=performance.now();try{const r=await fetch(origin+path,{headers,signal:AbortSignal.timeout(15000)});const body=await r.json().catch(()=>({}));console.log('UPSTREAM_PROBE',JSON.stringify({path:path.split('?')[0],status:r.status,ms:Math.round(performance.now()-start),error:r.ok?null:(body.code??'HTTP_ERROR')}));}catch(e){console.log('UPSTREAM_PROBE',JSON.stringify({path:path.split('?')[0],ms:Math.round(performance.now()-start),error:e.cause?.code??e.name}));}
 }
})().catch(()=>{console.error('DIAGNOSTIC_FAILED');process.exitCode=1;});
