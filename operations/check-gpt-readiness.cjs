require('@next/env').loadEnvConfig(process.cwd());
const fs=require('node:fs');
const worker=fs.readFileSync('/etc/xd-discord-bot.env','utf8');
const has=(name)=>Boolean(process.env[name])||new RegExp('^'+name+'=.+','m').test(worker);
console.log('GPT_RECOGNITION_CONFIGURATION',JSON.stringify({web_api_key:Boolean(process.env.OPENAI_API_KEY),worker_api_key:/^OPENAI_API_KEY=.+/m.test(worker),openai_model:has('OPENAI_MODEL'),gateway_key:has('AI_GATEWAY_API_KEY')}));
