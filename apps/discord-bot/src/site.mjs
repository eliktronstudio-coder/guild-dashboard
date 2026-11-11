export class SiteError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
export function siteClient(origin, secret) {
  const url = new URL(origin);
  if (
    url.origin !== origin ||
    (url.protocol !== "https:" &&
      !["127.0.0.1", "localhost"].includes(url.hostname))
  )
    throw Error("INVALID_SITE_ORIGIN");
  return async (operation, body, application) => {
    const target = new URL("/api/discord/" + operation, origin);
    if (application) target.searchParams.set("application", application);
    const r = await fetch(target, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: "Bearer " + secret,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(45000),
      redirect: "error",
    });
    let data;
    try {
      data = await r.json();
    } catch {
      throw new SiteError("SITE_UNAVAILABLE");
    }
    if (!r.ok) throw new SiteError(data.error ?? "SITE_UNAVAILABLE");
    return data;
  };
}
export function safeError(error) {
  const messages = {
    FULL_NICKNAME_REQUIRED:
      "Перед запоминанием введите полный ник через «Исправить и запомнить».",
    NAMES_NOT_CONFIRMED: "Сначала проверьте все неразобранные ники.",
    INVALID_NICKNAME:
      "Укажите ник из 2–32 букв, цифр, пробелов, дефисов или подчёркиваний.",
    DRAFT_CHANGED:
      "Этот ник уже изменён. Выберите актуальную строку в разборе.",
    TOO_MANY_GUESTS: "В одной активности допускается до 50 гостей.",
    EMPTY_CATALOG:
      "Реестр активностей сайта пуст. Сначала добавьте активности и коэффициенты на сайте.",
    TOO_MANY_IMAGES:
      "До четырёх изображений в одном разборе. Разделите сообщения или уберите лишние вложения.",
    OCR_NOT_INSTALLED:
      "Распознавание не настроено на сервере. Обратитесь к администратору.",
    INVALID_INPUT: "Проверьте выбор активности, тип и источник.",
    DISCORD_CHANNEL_FORBIDDEN: "Этот канал не разрешён в настройках сайта.",
    DISCORD_CONNECTION_OWNER_UNAVAILABLE:
      "Подключение сайта требует обновления администратором. Попросите администратора сохранить настройки Discord заново.",
    CATALOG_STALE:
      "Реестр изменился. Начните разбор заново, чтобы получить актуальные цены и коэффициент.",
    REQUEST_CONFLICT:
      "Это сообщение уже импортировано с другими данными. Проверьте журнал активностей на сайте.",
    INVALID_ROSTER:
      "Состав изменился или содержит недоступного игрока. Обновите список участников.",
    EVENT_IN_FUTURE: "Дата активности ещё не наступила.",
    UNAUTHORIZED: "Связь с сайтом не настроена.",
    OCR_BUSY: "Уже распознаётся другое изображение. Повторите через минуту.",
    IMAGE_TOO_LARGE:
      "Изображение слишком большое. До 12 МБ, не более 25 миллионов пикселей.",
    INVALID_IMAGE:
      "Не удалось прочитать изображение. Прикрепите PNG, JPEG или WebP.",
    DRAFT_EXPIRED:
      "Черновик истёк. Нажмите «Разобрать активность» у исходного сообщения.",
    ROSTER_CONFIRMATION_REQUIRED:
      "Нужно проверить и подтвердить непустой состав.",
  };
  return (
    messages[error?.code ?? error?.message] ??
    "Не удалось выполнить операцию. Данные не считаются сохранёнными; повторите попытку. При проблеме со связью повторное сохранение не создаст дубликат."
  );
}
