// Run only in a trusted terminal with secrets injected through environment settings.
// Never add these variables to a NEXT_PUBLIC_* name.
import { createClient } from '@supabase/supabase-js';
const names=['SUPABASE_URL','SUPABASE_SECRET_KEY','TELEGRAM_CLIENT_ID','TELEGRAM_CLIENT_SECRET'];
if(names.some(name=>!process.env[name])) {
 console.error('Missing required environment variable(s). See docs/SETUP.md.');process.exit(1);
}
const client=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const {error}=await client.auth.admin.customProviders.createProvider({
 provider_type:'oidc',identifier:'custom:telegram',name:'Telegram',
 client_id:process.env.TELEGRAM_CLIENT_ID,client_secret:process.env.TELEGRAM_CLIENT_SECRET,
 issuer:'https://oauth.telegram.org',scopes:['openid','profile'],
 email_optional:true,pkce_enabled:true,skip_nonce_check:false,custom_claims_allowlist:['id'],
});
if(error){console.error('Telegram provider was not created. Check provider configuration in Supabase; existing providers are not overwritten.');process.exit(1);}
console.log('Telegram OIDC provider created. Verify a complete login before enabling it for the guild.');
