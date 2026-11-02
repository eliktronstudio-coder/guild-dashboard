/** Offline configuration preflight. Never prints values or contacts external services. */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const e = process.env;
const errors = [];
const requireValue = key => { if (!e[key]?.trim()) errors.push(`${key}: отсутствует`); };
const flag = key => {
  if (e[key] && !['true', 'false'].includes(e[key])) errors.push(`${key}: ожидается true или false`);
  return e[key] === 'true';
};
for (const key of ['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','APP_ORIGIN']) requireValue(key);
for (const key of ['NEXT_PUBLIC_SUPABASE_URL','APP_ORIGIN']) {
  if (!e[key]) continue;
  try {
    const u = new URL(e[key]);
    if (u.protocol !== 'https:' || u.origin !== e[key] || u.username || u.password) throw Error();
  } catch { errors.push(`${key}: требуется точный HTTPS origin без пути и завершающего слеша`); }
}
const telegram = flag('AUTH_TELEGRAM_ENABLED');
const email = flag('AUTH_EMAIL_ENABLED');
const delivery = flag('AUTH_EMAIL_DELIVERY_READY');
const bot = flag('TELEGRAM_BOT_ENABLED');
const mini = flag('TELEGRAM_MINI_APP_ENABLED');
if (!telegram && !email) errors.push('Авторизация: не включён ни один способ входа');
if (email && !delivery) errors.push('Email: перед публичным запуском требуется проверенная доставка писем');
if (mini && !bot) errors.push('Mini App: требуется включённый бот');
if (bot) {
  requireValue('SUPABASE_SECRET_KEY');
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(e.TELEGRAM_BOT_TOKEN ?? '')) errors.push('TELEGRAM_BOT_TOKEN: отсутствует или неверный формат');
  if (!/^(?=.{5,32}$)[A-Za-z][A-Za-z0-9_]*bot$/i.test(e.TELEGRAM_BOT_USERNAME ?? '')) errors.push('TELEGRAM_BOT_USERNAME: неверный формат');
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(e.TELEGRAM_WEBHOOK_SECRET ?? '')) errors.push('TELEGRAM_WEBHOOK_SECRET: требуется 32–256 допустимых символов');
}
if (e.CRON_SECRET && e.CRON_SECRET.length < 32) errors.push('CRON_SECRET: требуется минимум 32 символа');
for (const key of Object.keys(e)) {
  if (key.startsWith('NEXT_PUBLIC_') && /(?:SECRET|PASSWORD|BOT_TOKEN|SERVICE_ROLE)/i.test(key) && e[key])
    errors.push(`${key}: секрет нельзя публиковать в клиентском окружении`);
}
console.log('XD: проверка конфигурации для HTTPS-размещения (без сетевых запросов).');
for (const error of errors) console.log(`ERROR: ${error}`);
console.log(errors.length ? `Обнаружено проблем: ${errors.length}.` : 'Формат и сочетания настроек проверены.');
console.log('Эта проверка не подтверждает миграции, права, доставку писем, webhook или работающий вход. Далее: docs/SETUP.md и живая приёмка двумя аккаунтами.');
process.exitCode = errors.length ? 1 : 0;
