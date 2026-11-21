const notices = {
  GPT_ROSTER_NOT_FOUND: "Не удалось выделить состав на изображении.",
  GPT_ROSTER_TOO_LARGE: "На изображении слишком много ячеек состава.",
  GPT_SERVICE_AUTH:
    "Сервис GPT не принял настройки подключения. Сообщите администратору.",
  GPT_SERVICE_CONFIG: "Сервис GPT ещё не настроен.",
  GPT_NO_KEY: "GPT не подключён.",
  GPT_DAILY_LIMIT: "Дневной лимит GPT исчерпан.",
  GPT_MONTHLY_LIMIT: "Месячный бюджет GPT исчерпан.",
  GPT_BUSY: "GPT занят другой операцией.",
  GPT_REGION_FORBIDDEN: "OpenAI отклонил запрос по региону сервера (403).",
  GPT_AUTH: "OpenAI отклонил API-ключ. Сообщите администратору.",
  GPT_QUOTA: "У OpenAI исчерпана квота или не подключена оплата.",
  GPT_RATE_LIMIT: "Достигнут лимит частоты OpenAI.",
  GPT_TIMEOUT: "OpenAI не ответил вовремя.",
  GPT_INVALID_REQUEST:
    "OpenAI отклонил формат запроса. Сообщите администратору.",
  GPT_MODEL_UNAVAILABLE: "Модель GPT недоступна этому API-проекту.",
  GPT_ERROR: "GPT временно недоступен.",
};
export function visionNotice(code) {
  return (
    (notices[code] ?? notices.GPT_ERROR) +
    " Повторите распознавание позже или введите данные вручную."
  );
}
// Classify provider errors using fixed identifiers only: never log the SDK message/body.
export function visionFailure(error) {
  if (Object.hasOwn(notices, error?.message)) return error.message;
  if (
    error?.status === 403 &&
    error?.code === "unsupported_country_region_territory"
  )
    return "GPT_REGION_FORBIDDEN";
  if (error?.status === 401 || error?.status === 403) return "GPT_AUTH";
  if (
    error?.code === "insufficient_quota" ||
    error?.code === "billing_hard_limit_reached"
  )
    return "GPT_QUOTA";
  if (error?.status === 429) return "GPT_RATE_LIMIT";
  if (
    error?.name === "APIConnectionTimeoutError" ||
    error?.status === 408 ||
    error?.status === 504
  )
    return "GPT_TIMEOUT";
  if (error?.status === 400 || error?.status === 422)
    return "GPT_INVALID_REQUEST";
  if (error?.status === 404) return "GPT_MODEL_UNAVAILABLE";
  return "GPT_ERROR";
}
function number(env, key, fallback, min, max) {
  const n = Number(env[key] ?? fallback);
  if (!Number.isFinite(n) || n < min || n > max) throw Error("Invalid " + key);
  return n;
}
export function visionConfig(env = process.env, now = Date.now()) {
  const model = env.OPENAI_MODEL ?? "gpt-5.4-mini";
  if (!/^gpt-5\.4-mini(?:-2026-03-17)?$/.test(model))
    throw Error("Unsupported OPENAI_MODEL pricing");
  const timeout = number(
      env,
      "OPENAI_TIMEOUT_MS",
      env.VISION_SERVICE_URL ? 120000 : 60000,
      1000,
      180000,
    ),
    maxOutput = number(env, "OPENAI_MAX_OUTPUT_TOKENS", 8192, 512, 16384);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: env.OPENAI_BUDGET_TIMEZONE ?? "Asia/Yekaterinburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
  return {
    model,
    timeout,
    maxOutput,
    daily:
      String(env.OPENAI_DAILY_LIMIT ?? "unlimited")
        .trim()
        .toLowerCase() === "unlimited"
        ? null
        : number(env, "OPENAI_DAILY_LIMIT", 0, 0, 10000),
    concurrent: number(env, "OPENAI_CONCURRENCY", 2, 1, 2),
    monthlyMicros: Math.floor(
      number(env, "OPENAI_MONTHLY_BUDGET_USD", 5, 0, 5) * 1e6,
    ),
    reserveMicros: Math.ceil(400000 * 0.75 + maxOutput * 4.5),
    cacheTtl: number(env, "OPENAI_CACHE_DAYS", 30, 1, 90) * 86400000,
    leaseMs: timeout + 30000,
    day: date,
    month: date.slice(0, 7),
  };
}
