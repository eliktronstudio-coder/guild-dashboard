import { randomUUID, createHash } from "node:crypto";
import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  LabelBuilder,
  FileUploadBuilder,
} from "discord.js";
import { reviewReady, readingSuggestions } from "./matching.mjs";
import { safeError } from "./site.mjs";
import {
  recognizeLoot,
  recognizeVisionLoot,
  rebuildLoot,
  refreshSimilarLoot,
  ensureLoot,
  lootReading,
  persistLoot,
  resolveLoot,
  addLootReading,
} from "./loot-review.mjs";
import {
  recognizeIndependentRoster,
  manuallyReadRoster,
  resolveReading,
  correctAnyReading,
} from "./recognition.mjs";
import { gameNickname, nicknameKey } from "./nickname-memory.mjs";
function memoryChoices(names = []) {
  return names.map((nickname) => ({
    id:
      "known_" +
      createHash("sha256").update(nicknameKey(nickname)).digest("hex"),
    nickname,
  }));
}
function confirmedNames(d) {
  return [
    ...d.roster.members.map((m) => m.nickname),
    ...d.roster.guests.filter(
      (name) =>
        !d.roster.readings?.some(
          (r) =>
            r.name === name && r.truncated && r.origin === "confirmed-guest",
        ),
    ),
  ];
}
function confirmedExamples(d) {
  return (d.roster.readings ?? [])
    .filter(
      (r) =>
        r.verifiedCell &&
        !r.pending &&
        !r.ignored &&
        r.name &&
        ((r.origin === "registry" && !r.truncated) ||
          ["manual-correction", "confirmed-selection"].includes(r.origin)),
    )
    .map((r) => ({
      name: r.name,
      key: r.key,
      imageKey: r.imageKey,
      variants: r.variants,
    }));
}
function focusedReading(d, index) {
  return d.roster.readings?.find(
    (r) => r.key === d.roster.unresolvedKeys?.[index],
  );
}

const row = (...components) => ({ type: 1, components });
const button = (id, label, style = 2, disabled = false) => ({
  type: 2,
  custom_id: id,
  label,
  style,
  disabled,
});
const select = (id, placeholder, options, values = [], max = 1, min = 1) =>
  row({
    type: 3,
    custom_id: id,
    placeholder,
    min_values: min,
    max_values: max,
    options: options.map((o) => ({ ...o, default: values.includes(o.value) })),
  });
const contextFor = (message, user) => ({
  server: message.guildId,
  channel: message.channelId,
  parent: message.channel?.isThread?.() ? message.channel.parentId : null,
  user,
});
const truncate = (v, length) => String(v).slice(0, length);
function activityDescription(d) {
  const source = `Импорт из Discord: https://discord.com/channels/${d.context.server}/${d.context.channel}/${d.message}`;
  if (d.rosterOnly)
    return (
      source +
      "\nСостав сохранён без внесения дропа. Дроп можно добавить позже."
    );
  if (!d.loot.unresolved.length) return source;
  const lines = [];
  let remaining = 3000;
  for (const raw of d.loot.unresolved) {
    const line = "• " + String(raw).replace(/[\r\n]+/gu, " ");
    if (line.length + 1 > remaining) break;
    lines.push(line);
    remaining -= line.length + 1;
  }
  return (
    source +
    `\n\nНеразобранный дроп: ${d.loot.unresolved.length} строк. Эти предметы не добавлены в инвентарь.\n` +
    lines.join("\n") +
    (lines.length < d.loot.unresolved.length
      ? "\nОстальные строки — на исходных скриншотах Discord."
      : "")
  );
}
function activityWeight(d) {
  return d.coefficientWeight ?? d.activity?.weight;
}
function parseCoefficient(value) {
  const text = value.trim().replace(",", ".");
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const weight = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return weight >= 1 && weight <= 100000 ? weight : null;
}
function rosterParticipants(d) {
  return [
    ...d.roster.members.map((m) => ({
      label: m.nickname,
      value: "m_" + m.id,
      memberId: m.id,
      name: m.nickname,
    })),
    ...d.roster.guests.map((name) => ({
      label: "Гость: " + name,
      value: "g_" + createHash("sha256").update(name).digest("hex"),
      name,
    })),
  ];
}
function excludeParticipant(d, participant) {
  if (participant.memberId)
    d.roster.members = d.roster.members.filter(
      (m) => m.id !== participant.memberId,
    );
  else d.roster.guests = d.roster.guests.filter((n) => n !== participant.name);
  const keys = new Set();
  for (const r of d.roster.readings ?? []) {
    if (
      participant.memberId
        ? r.memberId === participant.memberId
        : !r.memberId && r.name === participant.name
    ) {
      Object.assign(r, {
        ignored: true,
        pending: false,
        status: "исключён вручную",
      });
      keys.add(r.key);
    }
  }
  for (let i = (d.roster.unresolvedKeys?.length ?? 0) - 1; i >= 0; i--)
    if (keys.has(d.roster.unresolvedKeys[i])) {
      d.roster.unresolvedKeys.splice(i, 1);
      d.roster.unresolved.splice(i, 1);
    }
}
function controls(d) {
  const id = (action) => `xd:${d.id}:${action}`;
  if (d.step === "choose") {
    const page = d.page ?? 0,
      activities = d.catalog.activities.slice(page * 25, (page + 1) * 25);
    return [
      select(
        id("activity"),
        "Какая активность?",
        activities.map((a) => ({ label: truncate(a.name, 100), value: a.id })),
        [d.activity?.id],
      ),
      select(
        id("mode"),
        "Тип: PvP или PvE",
        [
          { label: "PvE", value: "raid" },
          { label: "PvP", value: "pvp" },
        ],
        [d.mode],
      ),
      select(
        id("source"),
        "Прайм или Мини-РБ",
        [
          { label: "Прайм", value: "prime" },
          { label: "Мини-РБ", value: "mini_rb" },
        ],
        [d.source],
      ),
      row(
        button(
          id("editCoefficient"),
          d.activity
            ? `Коэффициент: ×${(activityWeight(d) / 100).toLocaleString("ru-RU")} · базовый ×${(d.activity.weight / 100).toLocaleString("ru-RU")} · изменить`
            : "Коэффициент — выберите активность",
          2,
          !d.activity,
        ),
      ),
      row(
        ...(d.catalog.activities.length > 25
          ? [
              button(id("previous"), "←", 2, page === 0),
              button(
                id("nextpage"),
                "→",
                2,
                (page + 1) * 25 >= d.catalog.activities.length,
              ),
            ]
          : []),
        button(
          id("images"),
          d.analyzed ? "К проверке состава и дропа" : "Далее: скриншоты",
          1,
          !d.activity || !d.mode || !d.source,
        ),
      ),
    ];
  }
  if (d.step === "images")
    return [
      row(
        button(id("analyze"), "Распознать скрины", 1, !d.attachments.length),
        button(id("uploadLoot"), "Добавить скрины дропа"),
        button(id("backchoose"), "Назад"),
      ),
    ];
  if (d.step === "removeMember") {
    const entries = rosterParticipants(d),
      page = Math.max(
        0,
        Math.min(d.removePage ?? 0, Math.ceil(entries.length / 25) - 1),
      );
    return [
      ...(entries.length
        ? [
            select(
              id("removePick"),
              "Кого убрать из активности?",
              entries.slice(page * 25, (page + 1) * 25).map((m) => ({
                label: truncate(m.label, 100),
                value: m.value,
              })),
            ),
          ]
        : []),
      row(
        button(id("removePrev"), "←", 2, page === 0),
        button(id("removeNext"), "→", 2, (page + 1) * 25 >= entries.length),
        button(id("backreview"), "К проверке состава"),
      ),
    ];
  }
  if (d.step === "lootSearch") {
    const query = nicknameKey(d.lootSearchQuery ?? "");
    const items = d.catalog.drops
      .filter((i) => !query || nicknameKey(i.name).includes(query))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
    const page = Math.max(
      0,
      Math.min(d.lootSearchPage ?? 0, Math.ceil(items.length / 24) - 1),
    );
    return [
      select(id("lootPick"), "Поиск / выберите предмет", [
        { label: "Найти предмет…", value: "search" },
        ...items
          .slice(page * 24, (page + 1) * 24)
          .map((i) => ({ label: truncate(i.name, 100), value: i.id })),
      ]),
      row(
        button(id("lootPrev"), "←", 2, page === 0),
        button(id("lootNext"), "→", 2, (page + 1) * 24 >= items.length),
        button(id("lootAll"), "Все предметы"),
        button(id("reviewLoot"), "К дропу"),
      ),
    ];
  }
  if (d.step === "lootReview") {
    const rows = ensureLoot(d),
      focused = lootReading(d);
    const page = Math.max(
      0,
      Math.min(d.lootPage ?? 0, Math.ceil(rows.length / 25) - 1),
    );
    return [
      ...(rows.length
        ? [
            select(
              id("lootFocus"),
              "Какую строку дропа проверить?",
              rows.slice(page * 25, (page + 1) * 25).map((r) => ({
                label: truncate(
                  `${r.pending ? "? " : "✓ "}${r.pending ? r.raw : r.name} × ${r.quantity ?? "?"}`,
                  100,
                ),
                value: r.key,
              })),
              [focused?.key],
            ),
            select(
              id("lootPick"),
              focused?.suggestions?.some((i) => i.packVariant)
                ? "Выберите размер набора"
                : "Выберите предмет или действие",
              [
                ...(focused?.suggestions ?? []).map((i) => ({
                  label: truncate(i.name, 100),
                  value: i.id,
                })),
                { label: "Из реестра — поиск предмета", value: "registry" },
                { label: "Убрать строку дропа", value: "skip" },
              ],
            ),
          ]
        : []),
      row(
        button(id("lootPagePrev"), "←", 2, page === 0),
        button(id("lootPageNext"), "→", 2, (page + 1) * 25 >= rows.length),
        button(id("lootQuantity"), "Изменить количество", 2, !focused?.itemId),
      ),
      row(
        button(id("addLoot"), "Добавить предмет"),
        button(id("editloot"), "Исправить текстом"),
        button(id("backreview"), "К составу и сохранению"),
      ),
    ];
  }
  if (d.step === "memberSearch") {
    const query = nicknameKey(d.memberSearchQuery ?? "");
    const members = d.catalog.members
      .filter((m) => !query || nicknameKey(m.nickname).includes(query))
      .sort((a, b) => a.nickname.localeCompare(b.nickname, "ru"));
    const page = Math.max(
      0,
      Math.min(d.memberSearchPage ?? 0, Math.ceil(members.length / 24) - 1),
    );
    return [
      select(id("memberPick"), "Быстрый поиск / выберите игрока", [
        { label: "Найти по нику…", value: "search" },
        ...members.slice(page * 24, (page + 1) * 24).map((m) => ({
          label: truncate(m.nickname, 100),
          value: m.id,
        })),
      ]),
      row(
        button(id("memberPrev"), "←", 2, page === 0),
        button(id("memberNext"), "→", 2, (page + 1) * 24 >= members.length),
        button(id("memberAll"), "Все ники"),
        button(id("backreview"), "Назад"),
      ),
    ];
  }
  if (d.step === "names") {
    const readings = d.roster.readings ?? [],
      page = Math.max(
        0,
        Math.min(d.namesPage ?? 0, Math.ceil(readings.length / 25) - 1),
      ),
      batch = readings.slice(page * 25, (page + 1) * 25),
      focus = d.nameReviewFocusKey ?? batch[0]?.key;
    return [
      ...(batch.length
        ? [
            select(
              id("readingFocus"),
              "Выберите любой прочитанный ник",
              batch.map((r) => ({
                label:
                  truncate(
                    (r.pending ? "? " : "") +
                      (r.name ?? r.visible ?? "Ник не прочитан"),
                    100,
                  ) || "Ник не прочитан",
                value: r.key.slice(0, 24),
              })),
              [String(focus).slice(0, 24)],
            ),
          ]
        : []),
      row(
        button(id("nameprev"), "←", 2, page === 0),
        button(id("namenext"), "→", 2, (page + 1) * 25 >= readings.length),
        button(id("editnick"), "Исправить и запомнить", 1, !readings.length),
        button(id("backreview"), "К проверке состава"),
      ),
    ];
  }
  if (d.step === "confirm")
    return [
      row(
        button(
          id("publish"),
          d.rosterOnly
            ? "Подтверждаю состав — сохранить"
            : "Подтверждаю состав и дроп — сохранить",
          3,
        ),
        button(id("backreview"), "Вернуться к проверке"),
      ),
    ];
  const focus = Math.max(
      0,
      Math.min(d.roster.unresolved.length - 1, d.rosterFocus ?? 0),
    ),
    unknown = d.roster.unresolved[focus],
    hints = unknown
      ? readingSuggestions(focusedReading(d, focus) ?? { visible: unknown }, [
          ...d.catalog.members,
          ...(d.knownNicknameChoices ?? []).filter(
            (n) =>
              !d.catalog.members.some(
                (m) => nicknameKey(m.nickname) === nicknameKey(n.nickname),
              ),
          ),
        ])
      : [];
  const corrections = unknown
    ? [
        select(
          id("rosterFocus"),
          "Какой ник исправить?",
          d.roster.unresolved.slice(0, 25).map((raw, i) => ({
            label: truncate(raw, 95) || "Ник не прочитан",
            value: String(i),
          })),
          [String(focus)],
        ),
        select(id("rosterPick"), "Выберите игрока или действие", [
          ...hints.map((m) => ({
            label: truncate(m.nickname, 100),
            value: m.id,
          })),
          ...(unknown.length <= 80 && !/^Ячейка /u.test(unknown)
            ? [{ label: truncate("Гость: " + unknown, 100), value: "guest" }]
            : []),
          { label: "Добавить в активность — ник из состава", value: "roster" },
          { label: "Убрать из активности", value: "skip" },
        ]),
      ]
    : [];
  return [
    ...corrections,
    row(
      button(
        id("reviewNames"),
        "Проверить все прочитанные ники",
        2,
        !d.roster.readings?.length,
      ),
      button(id("addMember"), "Добавить в активность"),
      button(
        id("removeMember"),
        "Убрать из активности",
        2,
        !rosterParticipants(d).length,
      ),
    ),
    row(
      button(id("editroster"), "Исправить состав"),
      ...(unknown ? [button(id("editnick"), "Исправить и запомнить ник")] : []),
      button(id("reviewLoot"), "Проверить / исправить дроп"),
      button(
        id("remember"),
        "Запомнить проверенные ники",
        2,
        Boolean(d.roster.unresolved.length) ||
          !(d.roster.members.length + d.roster.guests.length),
      ),
      button(
        id("confirm"),
        d.rosterOnly ? "Сохранить состав" : "Сохранить на сайт",
        3,
      ),
    ),
    row(
      button(
        id("retryVision"),
        "Перечитать спорные GPT",
        2,
        !d.roster.readings?.some(
          (r) => r.pending && r.engine === "gpt" && r.box,
        ),
      ),
      ...(d.visionFailed
        ? [button(id("analyze"), "Повторить распознавание GPT")]
        : []),
      button(id("uploadLoot"), "Добавить скрины дропа"),
      button(id("backchoose"), "Параметры активности"),
    ),
  ];
}
export function reviewText(d) {
  return [
    `Активность: ${d.activity?.name ?? "ещё не выбрана"}; тип: ${d.mode ?? "не выбран"}; категория: ${d.source ?? "не выбрана"}; коэффициент ${d.activity ? (activityWeight(d) / 100).toFixed(2) : "не выбран"}`,
    `Дата сообщения: ${d.startsAt} UTC`,
    "",
    ...(d.recognitionNotices ?? []),
    "Ники со скриншота (чтение независимо от сайта):",
    ...(d.roster.readings ?? []).map(
      (r) =>
        `${r.origin === "manual-add" ? "[добавлен вручную]" : r.visible || "[не прочитан]"}${r.name ? " → " + r.name : ""}${r.origin === "memory" ? " [память исправлений]" : ""}${r.truncated ? " [обрезан на скрине]" : ""} [${r.status ?? "проверка"}]${r.group ? " группа " + r.group : ""}${r.pending && r.suggestions?.length ? " → варианты: " + r.suggestions.map((m) => m.nickname).join(", ") : ""}`,
    ),
    "",
    "Состав:",
    ...d.roster.members.map((m) => m.nickname),
    ...d.roster.guests.map((n) => "гость: " + n),
    ...d.roster.unresolved.map((n) => "? " + n),
    "",
    d.rosterOnly ? "Дроп отложен: не добавляется в активность." : "Дроп:",
    ...d.loot.items.map(
      (item) =>
        `${item.name} x${item.quantity} (${Number(item.price_units) / 10000} зол./ед.)`,
    ),
    ...d.loot.unresolved.map((n) => "? " + n),
    ...(d.loot.readings ?? []).map(
      (r) =>
        `${r.raw} → ${r.ignored ? "убрано" : r.name || "не прочитано"} × ${r.quantity ?? "?"} [${r.status}]`,
    ),
  ].join("\n");
}
export function renderDraft(d) {
  let content;
  if (d.event) {
    const weight =
      d.publication?.activity.coefficient ??
      (d.activity ? d.activity.weight / 100 : null);
    const coefficient =
      weight === null
        ? "не указан"
        : "×" +
          Number(weight).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
    const created = d.savedAt
      ? new Intl.DateTimeFormat("ru-RU", {
          dateStyle: "short",
          timeStyle: "short",
          timeZone: "Europe/Moscow",
        }).format(new Date(d.savedAt)) + " (МСК)"
      : "не указана";
    return {
      content: `Активность сохранена: ${d.event.url}\nНазвание: ${d.publication?.activity.title ?? d.activity?.name ?? "не указано"}\nКоэффициент: ${coefficient}\nДата создания: ${created}\n${d.rosterOnly ? "Состав сохранён без дропа. Дроп можно добавить позже в карточке активности.\n" : ""}${d.nicknameMemoryFailed ? "Память ников временно недоступна." : "Подтверждённые ники добавлены в память бота."}`,
      components: [],
      embeds: [],
      attachments: [],
      allowedMentions: { parse: [] },
    };
  }
  if (d.step === "choose")
    content =
      (d.analyzed ? "Скриншоты распознаны — состав и дроп ниже. " : "") +
      "Выберите активность из реестра сайта, тип и источник. Данные пока не сохраняются на сайт.";
  else if (d.step === "images")
    content = `Первый скрин — состав, остальные — дроп. Скрин состава: ${d.attachments[0]?.name ?? "не прикреплён"}. Скриншотов дропа: ${d.lootImages.length}. Нажмите «Распознать скрины»; если дропа нет, сохранится только состав. Ещё скрины дропа можно добавлять партиями до 10 файлов. Уже прочитанные скрины повторно не анализируются. На сайт прикрепляются состав и первые 7 скринов дропа; предметы учитываются из всех скринов. Текст сообщения как дроп не используется.`;
  else if (d.step === "lootReview")
    content =
      "Проверьте распознанный дроп. Выберите строку, затем предмет и количество. Спорные позиции не сохраняются без подтверждения. Удаление строки убирает только её из черновика.";
  else if (d.step === "lootSearch")
    content = `Поиск предмета: «${d.lootSearchQuery || "все предметы"}». Выберите предмет из реестра, затем укажите количество.`;
  else if (d.step === "memberSearch")
    content = `Поиск по составу сайта: «${d.memberSearchQuery || "все игроки"}». ${d.memberSearchMode === "add" ? "Добавьте участника в эту активность." : `Выберите игрока для «${d.memberSearchRaw}».`} Ников в списке: ${d.catalog.members.filter((m) => !nicknameKey(d.memberSearchQuery ?? "") || nicknameKey(m.nickname).includes(nicknameKey(d.memberSearchQuery ?? ""))).length}. Страница ${(d.memberSearchPage ?? 0) + 1}.`;
  else if (d.step === "removeMember")
    content =
      "Выберите участника или гостя, которого нужно убрать из этой активности. При сохранении он не попадёт в её состав. Можно снова добавить его через поиск по составу сайта.";
  else if (d.step === "names")
    content =
      "Выберите любой прочитанный ник, даже уже распознанный. «Исправить и запомнить» сохраняет полный игровой ник и пример чтения. Наличие аккаунта на сайте не требуется.";
  else if (d.step === "confirm")
    content = `Подтвердите полный состав: ${d.roster.members.length} зарегистрированных игроков и ${d.roster.guests.length} гостей. Остальные подходящие участники сайта будут отмечены отсутствующими; гости не входят в статистику. ${d.rosterOnly ? "Дроп не добавляется; его можно внести позже в карточке активности." : "Дроп: " + d.loot.items.length + " подтверждённых позиций." + (d.loot.unresolved.length ? ` Спорные строки (${d.loot.unresolved.length}) сохранятся в описании активности.` : "")} Коэффициент: ×${(activityWeight(d) / 100).toLocaleString("ru-RU")}. Дата берётся из исходного сообщения. Начисления и выплаты не создаются.`;
  else {
    content = `${d.activity.name} · ${d.mode === "pvp" ? "PvP" : "PvE"} · ${d.source === "prime" ? "Прайм" : "Мини РБ"} · коэффициент ×${(activityWeight(d) / 100).toLocaleString("ru-RU")}\nПроверьте состав и дроп ниже. Полный список — в файле. Обрезанные ники требуют подтверждения; «Из состава» позволяет найти любого зарегистрированного игрока. Если дропа нет, активность сохранится без него.`;
  }
  return {
    content: truncate(
      (d.recognitionNotices ?? []).join("\n") +
        "\n" +
        (d.step === "review"
          ? [
              "точно",
              "автосопоставлено",
              "похожие",
              "не найден",
              "ручная проверка",
            ]
              .map(
                (status) =>
                  status +
                  ": " +
                  (d.roster.readings ?? []).filter((r) => r.status === status)
                    .length,
              )
              .join(" · ") + "\n"
          : "") +
        content,
      1950,
    ),
    allowedMentions: { parse: [] },
    components: controls(d),
    embeds:
      ["review", "names", "lootReview", "lootSearch"].includes(d.step) ||
      (d.step === "choose" && d.analyzed)
        ? [
            {
              title: "Распознанные ники",
              description: truncate(
                [
                  ...d.roster.members.map((m) => m.nickname),
                  ...d.roster.guests.map((n) => "Гость: " + n),
                ].join("\n") || "Нет подтверждённых ников",
                2000,
              ),
            },
            {
              title: "Нераспознанные / требуют проверки",
              description: truncate(
                d.roster.unresolved.join("\n") ||
                  "Нет — все прочитанные ники проверены",
                1000,
              ),
            },
            {
              title: "Распознанный дроп",
              description: truncate(
                [...d.loot.items.map((i) => `${i.name} × ${i.quantity}`)].join(
                  "\n",
                ) ||
                  (d.loot.unresolved.length
                    ? "Нет подтверждённых предметов — проверьте спорные строки"
                    : "Дроп не найден — можно сохранить только состав"),
                1600,
              ),
            },
            {
              title: "Дроп — требуется проверка",
              description: truncate(
                d.loot.unresolved.join("\n") || "Нет спорных позиций",
                800,
              ),
            },
          ]
        : [],
    attachments: [],
    ...(["review", "names", "lootReview", "lootSearch"].includes(d.step) ||
    (d.step === "choose" && d.analyzed)
      ? {
          files: [
            {
              attachment: Buffer.from(reviewText(d), "utf8"),
              name: "activity-review.txt",
            },
          ],
        }
      : {}),
  };
}
export class ImportWorkflow {
  constructor({ site, store, download, ocr, prepareEvidence, fetchMessage }) {
    Object.assign(this, {
      site,
      store,
      download,
      ocr,
      prepareEvidence,
      fetchMessage,
    });
    this.locks = new Set();
  }
  async start(interaction, message, { automatic = false } = {}) {
    if (!interaction.deferred) await interaction.deferReply({ flags: 64 });
    try {
      const context = contextFor(message, interaction.user.id),
        catalog = await this.site("context", { context });
      if (!catalog.activities.length) throw Error("EMPTY_CATALOG");
      const attachments = [...message.attachments.values()].filter(
        (a) =>
          /^image\/(png|jpe?g|webp)$/i.test(a.contentType ?? "") ||
          /\.(png|jpe?g|webp)$/i.test(a.name ?? ""),
      );
      if (attachments.length > 10) throw Error("TOO_MANY_IMAGES");
      if (attachments.some((a) => a.size > 12 * 1024 * 1024))
        throw Error("IMAGE_TOO_LARGE");
      const d = {
        id: randomUUID(),
        request: randomUUID(),
        owner: interaction.user.id,
        context,
        message: message.id,
        startsAt: new Date(message.createdTimestamp).toISOString().slice(0, 19),
        content: "",
        screensOnly: true,
        automaticNeedsChoice: automatic,
        processedImages: {},
        lootImageResults: {},
        attachments: attachments.map((a) => ({
          id: a.id,
          name: a.name,
          url: a.url,
        })),
        rosterImages: attachments.length ? [attachments[0].id] : [],
        lootImages: attachments.slice(1).map((a) => a.id),
        catalog,
        step: "choose",
        roster: { members: [], guests: [], unresolved: [] },
        loot: { items: [], unresolved: [] },
        evidence: [],
        lootRequests: {},
      };
      this.store.put(d);
      if (automatic)
        await this.handle({ ...interaction, customId: `xd:${d.id}:analyze` });
      else await interaction.editReply(renderDraft(d));
    } catch (e) {
      await interaction.editReply({ content: safeError(e), components: [] });
    }
  }
  async handle(interaction) {
    const [, id, action, targetKey, targetItem] =
      interaction.customId.split(":");
    let d,
      acquired = false;
    try {
      d = this.store.get(id);
      if (d.owner !== interaction.user.id)
        return interaction.reply({
          content:
            "Этот черновик открыт другим участником. Начните свой разбор у исходного сообщения.",
          flags: 64,
        });
      if (this.locks.has(id))
        return interaction.reply({
          content: "Операция уже выполняется. Дождитесь завершения.",
          flags: 64,
        });
      if (action === "analyzeTesseract") throw Error("OCR_DISABLED");
      if (d.event) {
        if (!interaction.deferred && !interaction.replied)
          await interaction.deferUpdate();
        return interaction.editReply(renderDraft(d));
      }
      if (
        action === "lootSearch" ||
        (action === "lootPick" && interaction.values?.[0] === "search")
      ) {
        return interaction.showModal(
          new ModalBuilder()
            .setCustomId(`xd:${id}:lootQuery`)
            .setTitle("Найти предмет в реестре")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("value")
                  .setLabel("Часть названия; пусто — все предметы")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setMaxLength(100),
              ),
            ),
        );
      }
      if (
        action === "lootQuantity" ||
        (action === "lootPick" &&
          !["registry", "skip"].includes(interaction.values?.[0]))
      ) {
        const reading = lootReading(d),
          itemId =
            action === "lootQuantity"
              ? reading?.itemId
              : interaction.values?.[0];
        const item = d.catalog.drops.find((i) => i.id === itemId);
        if (!reading || !item) throw Error("DRAFT_CHANGED");
        return interaction.showModal(
          new ModalBuilder()
            .setCustomId(`xd:${id}:lq:${reading.key}:${item.id}`)
            .setTitle("Количество предмета")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("value")
                  .setLabel(truncate(item.name, 45))
                  .setStyle(TextInputStyle.Short)
                  .setValue(String(reading.quantity ?? 1))
                  .setRequired(true)
                  .setMaxLength(7),
              ),
            ),
        );
      }
      if (action === "editCoefficient") {
        if (!d.activity) throw Error("INVALID_INPUT");
        return interaction.showModal(
          new ModalBuilder()
            .setCustomId(`xd:${id}:coefficientValue`)
            .setTitle("Коэффициент активности")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("value")
                  .setLabel("Коэффициент: 0,01–1000; до 2 знаков")
                  .setStyle(TextInputStyle.Short)
                  .setValue((activityWeight(d) / 100).toFixed(2))
                  .setMaxLength(7)
                  .setRequired(true),
              ),
            ),
        );
      }
      if (action === "uploadLoot") {
        return interaction.showModal(
          new ModalBuilder()
            .setCustomId(`xd:${id}:lootFiles`)
            .setTitle("Добавить скрины дропа")
            .addLabelComponents(
              new LabelBuilder()
                .setLabel("Скриншоты дропа — до 10 за раз")
                .setFileUploadComponent(
                  new FileUploadBuilder()
                    .setCustomId("files")
                    .setMinValues(1)
                    .setMaxValues(10)
                    .setRequired(true),
                ),
            ),
        );
      }
      if (
        action === "memberSearch" ||
        (action === "memberPick" && interaction.values?.[0] === "search")
      ) {
        return interaction.showModal(
          new ModalBuilder()
            .setCustomId(`xd:${id}:memberQuery`)
            .setTitle("Найти игрока в составе сайта")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("value")
                  .setLabel("Начните вводить ник; пусто — весь состав")
                  .setStyle(TextInputStyle.Short)
                  .setMaxLength(32)
                  .setRequired(false),
              ),
            ),
        );
      }
      if (action === "extra") {
        const modal = new ModalBuilder()
          .setCustomId(`xd:${id}:extratext`)
          .setTitle("Дроп из другого сообщения")
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("value")
                .setLabel("ID сообщения с дропом в этом канале")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(22),
            ),
          );
        return interaction.showModal(modal);
      }
      if (action === "editnick") {
        const focus = Math.max(
          0,
          Math.min(d.roster.unresolved.length - 1, d.rosterFocus ?? 0),
        );
        const reading =
            d.step === "names"
              ? (d.roster.readings ?? []).find(
                  (r) =>
                    r.key ===
                    (d.nameReviewFocusKey ??
                      d.roster.readings?.[(d.namesPage ?? 0) * 25]?.key),
                )
              : focusedReading(d, focus),
          key = reading?.key?.slice(0, 24) ?? "legacy_" + focus;
        if (!reading && !d.roster.unresolved[focus])
          throw Error("INVALID_INPUT");
        const modal = new ModalBuilder()
          .setCustomId(`xd:${id}:correctNick_${key}`)
          .setTitle("Исправить и запомнить ник")
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("value")
                .setLabel("Полный ник в игре — можно без аккаунта сайта")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(32),
            ),
          );
        return interaction.showModal(modal);
      }
      if (action === "editroster" || action === "editloot") {
        const text =
          action === "editroster"
            ? [
                ...d.roster.members.map((m) => m.nickname),
                ...d.roster.guests.map((n) => "гость: " + n),
                ...d.roster.unresolved.map((n) => "? " + n),
              ].join("\n")
            : [
                ...d.loot.items.map((item) => `${item.name} x${item.quantity}`),
                ...d.loot.unresolved.map((n) => "? " + n),
              ].join("\n");
        const modal = new ModalBuilder()
          .setCustomId(
            `xd:${id}:${action === "editroster" ? "rostertext" : "loottext"}`,
          )
          .setTitle(
            action === "editroster"
              ? "Состав: один ник на строку"
              : "Дроп: Название xКоличество",
          )
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("value")
                .setLabel(
                  action === "editroster"
                    ? "Ник / гость: Ник. Проверьте строки с «?»"
                    : "Предмет x5. Нет дропа — оставьте пустым.",
                )
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
                .setMaxLength(4000)
                .setValue(text.slice(0, 4000)),
            ),
          );
        return interaction.showModal(modal);
      }
      this.locks.add(id);
      acquired = true;
      await interaction.deferUpdate();
      if (d.event) {
        await interaction.editReply(renderDraft(d));
        return;
      }
      if (action === "reviewLoot") {
        refreshSimilarLoot(d);
        const rows = ensureLoot(d);
        const target = rows.find((r) => r.pending) ?? lootReading(d);
        d.lootFocusKey = target?.key;
        d.lootPage = Math.max(
          0,
          Math.floor(rows.findIndex((r) => r.key === target?.key) / 25),
        );
        d.step = "lootReview";
      } else if (action === "lootFocus") {
        const reading = ensureLoot(d).find(
          (r) => r.key === interaction.values[0],
        );
        if (!reading) throw Error("DRAFT_CHANGED");
        d.lootFocusKey = reading.key;
      } else if (
        action === "addLoot" ||
        (action === "lootPick" && interaction.values[0] === "registry")
      ) {
        if (action === "addLoot") addLootReading(d);
        if (!lootReading(d)) throw Error("DRAFT_CHANGED");
        d.lootFocusKey = lootReading(d).key;
        d.lootSearchQuery = "";
        d.lootSearchPage = 0;
        d.step = "lootSearch";
      } else if (action === "lootPick" && interaction.values[0] === "skip") {
        const reading = lootReading(d);
        if (!reading) throw Error("DRAFT_CHANGED");
        reading.ignored = true;
        persistLoot(d);
        d.lootFocusKey = lootReading(d)?.key;
        d.step = "lootReview";
      } else if (action === "lq") {
        const text = interaction.fields.getTextInputValue("value").trim();
        if (!/^\d{1,7}$/.test(text)) throw Error("INVALID_LOOT_QUANTITY");
        resolveLoot(d, targetKey, targetItem, Number(text));
        d.lootFocusKey = targetKey;
        d.step = "lootReview";
      } else if (action === "lootQuery" || action === "lootAll") {
        d.lootSearchQuery =
          action === "lootAll"
            ? ""
            : interaction.fields.getTextInputValue("value").trim();
        d.lootSearchPage = 0;
        d.step = "lootSearch";
      } else if (action === "lootPrev" || action === "lootNext") {
        const query = nicknameKey(d.lootSearchQuery ?? "");
        const count = d.catalog.drops.filter(
          (i) => !query || nicknameKey(i.name).includes(query),
        ).length;
        d.lootSearchPage = Math.max(
          0,
          Math.min(
            Math.ceil(count / 24) - 1,
            (d.lootSearchPage ?? 0) + (action === "lootPrev" ? -1 : 1),
          ),
        );
      } else if (action === "lootPagePrev" || action === "lootPageNext") {
        const rows = ensureLoot(d);
        d.lootPage = Math.max(
          0,
          Math.min(
            Math.ceil(rows.length / 25) - 1,
            (d.lootPage ?? 0) + (action === "lootPagePrev" ? -1 : 1),
          ),
        );
        d.lootFocusKey = rows[d.lootPage * 25]?.key;
      } else if (action === "coefficientValue") {
        if (!d.activity) throw Error("INVALID_INPUT");
        const weight = parseCoefficient(
          interaction.fields.getTextInputValue("value"),
        );
        if (weight === null) throw Error("INVALID_COEFFICIENT");
        d.coefficientWeight = weight;
      } else if (action === "lootFiles") {
        const files = [
          ...interaction.fields.getUploadedFiles("files", true).values(),
        ];
        if (
          !files.length ||
          files.length > 10 ||
          files.some(
            (a) =>
              !/^image\/(png|jpe?g|webp)$/i.test(a.contentType ?? "") ||
              a.size > 12 * 1024 * 1024,
          )
        )
          throw Error("INVALID_IMAGE");
        for (const a of files) {
          if (d.attachments.some((old) => old.id === a.id)) continue;
          d.attachments.push({ id: a.id, name: a.name, url: a.url });
          d.lootImages.push(a.id);
        }
        d.rosterOnly = false;
        d.analyzed = false;
        d.step = "images";
      } else if (
        action === "addMember" ||
        (action === "rosterPick" && interaction.values[0] === "roster")
      ) {
        if (action === "addMember") {
          d.memberSearchMode = "add";
          delete d.memberSearchReadingKey;
          delete d.memberSearchRaw;
        } else {
          d.memberSearchMode = "resolve";
          const reading = focusedReading(d, d.rosterFocus ?? 0);
          d.memberSearchReadingKey = reading?.key;
          d.memberSearchRaw = d.roster.unresolved[d.rosterFocus ?? 0];
          if (!d.memberSearchRaw) throw Error("DRAFT_CHANGED");
        }
        if (this.site) {
          const fresh = await this.site("context", { context: d.context });
          if (Array.isArray(fresh?.members)) d.catalog.members = fresh.members;
        }
        d.memberSearchQuery = "";
        d.memberSearchPage = 0;
        d.step = "memberSearch";
      } else if (action === "memberAll") {
        d.memberSearchQuery = "";
        d.memberSearchPage = 0;
        d.step = "memberSearch";
      } else if (action === "memberQuery") {
        if (this.site) {
          const fresh = await this.site("context", { context: d.context });
          if (Array.isArray(fresh?.members)) d.catalog.members = fresh.members;
        }
        d.memberSearchQuery = interaction.fields
          .getTextInputValue("value")
          .trim();
        d.memberSearchPage = 0;
        d.step = "memberSearch";
      } else if (action === "memberPrev" || action === "memberNext") {
        const query = nicknameKey(d.memberSearchQuery ?? "");
        const count = d.catalog.members.filter(
          (m) => !query || nicknameKey(m.nickname).includes(query),
        ).length;
        d.memberSearchPage = Math.max(
          0,
          Math.min(
            Math.ceil(count / 24) - 1,
            (d.memberSearchPage ?? 0) + (action === "memberPrev" ? -1 : 1),
          ),
        );
      } else if (
        ["activity", "mode", "source", "rosterImages", "lootImages"].includes(
          action,
        )
      ) {
        if (action === "activity") {
          const previous = d.activity?.id;
          d.activity = d.catalog.activities.find(
            (a) => a.id === interaction.values[0],
          );
          if (!d.activity) throw Error("INVALID_INPUT");
          if (previous !== d.activity.id || d.coefficientWeight === undefined)
            d.coefficientWeight = d.activity.weight;
        } else if (action === "rosterImages" || action === "lootImages") {
          if (
            interaction.values.some(
              (v) => !d.attachments.some((a) => a.id === v),
            )
          )
            throw Error("INVALID_IMAGE");
          d[action] = interaction.values;
          d.analyzed = false;
        } else d[action] = interaction.values[0];
      } else if (action === "previous" || action === "nextpage")
        d.page = Math.max(
          0,
          Math.min(
            Math.ceil(d.catalog.activities.length / 25) - 1,
            (d.page ?? 0) + (action === "previous" ? -1 : 1),
          ),
        );
      else if (action === "images") {
        if (
          !d.activity ||
          !["raid", "pvp"].includes(d.mode) ||
          !["prime", "mini_rb"].includes(d.source)
        )
          throw Error("INVALID_INPUT");
        d.automaticNeedsChoice = false;
        d.step = d.analyzed ? "review" : "images";
      } else if (action === "backchoose") d.step = "choose";
      else if (action === "extratext") {
        const target = interaction.fields.getTextInputValue("value").trim();
        if (!/^\d{17,22}$/.test(target)) throw Error("INVALID_INPUT");
        await this.site("context", { context: d.context });
        const message = await this.fetchMessage(d.context, target);
        if (
          message.channelId !== d.context.channel ||
          message.guildId !== d.context.server ||
          message.author.bot
        )
          throw Error("DISCORD_CHANNEL_FORBIDDEN");
        if (!(d.extraMessages ?? []).includes(target)) {
          const additions = [...message.attachments.values()].filter((a) =>
            /^image\/(png|jpe?g|webp)$/i.test(a.contentType ?? ""),
          );
          if (
            d.attachments.length + additions.length > 4 ||
            additions.some((a) => a.size > 12 * 1024 * 1024)
          )
            throw Error("IMAGE_TOO_LARGE");
          d.content += "\n" + message.content;
          for (const a of additions) {
            d.attachments.push({ id: a.id, name: a.name, url: a.url });
            d.lootImages.push(a.id);
          }
          d.extraMessages = [...(d.extraMessages ?? []), target];
        }
        d.analyzed = false;
        d.step = "images";
      } else if (action === "analyze" || action === "analyzeRoster") {
        d.rosterOnly = action === "analyzeRoster";
        await interaction.editReply({
          content:
            "Распознаю состав и скриншоты дропа… При нескольких скринах это может занять несколько минут.",
          embeds: [],
          components: [],
          attachments: [],
        });
        const fresh = await this.site("context", { context: d.context });
        if (Array.isArray(fresh?.members)) d.catalog.members = fresh.members;
        d.recognitionNotices =
          d.screensOnly && d.rosterAnalyzed ? (d.recognitionNotices ?? []) : [];
        const knownNames = this.store.knownNicknames?.(d.context.server) ?? [];
        d.knownNicknameChoices = memoryChoices(knownNames);
        let rosterFailed = false;
        d.visionFailed = false;
        const liveVisionItems = [];
        const words = [],
          lootLines = d.rosterOnly || d.screensOnly ? [] : [d.content];
        const cached = d.screensOnly ? (d.processedImages ??= {}) : {};
        const previousEvidence = d.evidence ?? [];
        const reuseRoster = d.screensOnly && d.rosterAnalyzed === true;
        d.evidence = [];
        for (const attachment of d.attachments) {
          if (
            !d.rosterImages.includes(attachment.id) &&
            (d.rosterOnly || !d.lootImages.includes(attachment.id))
          )
            continue;
          if (cached[attachment.id]) continue;
          const buffer = await this.download(attachment.url);
          const imageHash = createHash("sha256").update(buffer).digest("hex");
          if (
            d.screensOnly &&
            (d.processedImageHashes ?? []).includes(imageHash)
          ) {
            cached[attachment.id] = true;
            continue;
          }
          const result = await this.ocr(buffer, {
              scope: d.context.server,
              roster: d.rosterImages.includes(attachment.id),
              loot: !d.rosterOnly && d.lootImages.includes(attachment.id),
              members: d.catalog.members,
              drops: d.catalog.drops,
              knownNames,
            }),
            image = await this.prepareEvidence(buffer);
          d.visionFailed ||=
            result.failed === true || result.lootFailed === true;
          if (result.notice && !d.recognitionNotices.includes(result.notice))
            d.recognitionNotices.push(result.notice);
          if (d.rosterImages.includes(attachment.id)) {
            rosterFailed ||= result.failed === true;
            words.push(
              ...result.words.map((w) => ({
                ...w,
                attachmentId: attachment.id,
                line: attachment.id + ":" + w.line,
                ...(w.region !== undefined
                  ? { region: attachment.id + ":" + w.region }
                  : {}),
              })),
            );
            d.evidence.push({ id: randomUUID(), kind: "roster", image });
          }
          if (!d.rosterOnly && d.lootImages.includes(attachment.id)) {
            const failed = result.failed === true || result.lootFailed === true;
            if (d.screensOnly) {
              (d.lootImageResults ??= {})[attachment.id] = failed
                ? "? Не удалось прочитать скрин дропа — исправьте вручную или повторите распознавание"
                : result.text;
              if (!failed && Array.isArray(result.lootItems))
                (d.lootImageVisionResults ??= {})[attachment.id] =
                  result.lootItems;
            } else if (!failed) {
              if (Array.isArray(result.lootItems))
                liveVisionItems.push(...result.lootItems);
              else lootLines.push(result.text);
            } else lootLines.push("? Не удалось прочитать скрин дропа");
            d.evidence.push({ id: randomUUID(), kind: "loot", image });
          }
          if (result.failed || result.lootFailed) continue;
          cached[attachment.id] = true;
          if (d.screensOnly) (d.processedImageHashes ??= []).push(imageHash);
        }
        if (d.screensOnly) {
          if (d.lootOverride !== undefined) lootLines.push(d.lootOverride);
          lootLines.push(
            ...Object.entries(d.lootImageResults ?? {})
              .filter(
                ([id]) =>
                  !(d.lootOverrideImages ?? []).includes(id) &&
                  !d.lootImageVisionResults?.[id],
              )
              .map(([, text]) => text),
          );
          d.evidence = [...previousEvidence, ...d.evidence]
            .sort(
              (a, b) =>
                (a.kind === "roster" ? 0 : 1) - (b.kind === "roster" ? 0 : 1),
            )
            .slice(0, 8);
        }
        d.recognitionWords = reuseRoster ? d.recognitionWords : words;
        if (!reuseRoster && !rosterFailed)
          d.roster = recognizeIndependentRoster(words, d.catalog.members, {
            recall: (reading) =>
              this.store.recallNickname?.(d.context.server, reading) ?? {},
          });
        d.rosterAnalyzed = !rosterFailed;
        d.rosterFocus = 0;
        const fromText = recognizeLoot(lootLines.join("\n"), d.catalog.drops);
        const visionItems = Object.entries(d.lootImageVisionResults ?? {})
          .filter(([id]) => !(d.lootOverrideImages ?? []).includes(id))
          .flatMap(([, items]) => items);
        const fromVision = recognizeVisionLoot(
          [...visionItems, ...liveVisionItems],
          d.catalog.drops,
        );
        d.loot = rebuildLoot(
          [...fromText.readings, ...fromVision.readings],
          d.catalog.drops,
        );
        d.analyzed = true;
        d.step = d.automaticNeedsChoice ? "choose" : "review";
      } else if (action === "retryVision") {
        const pending = d.roster.readings.filter(
          (r) => r.pending && r.engine === "gpt" && r.box,
        );
        if (!pending.length) throw Error("DRAFT_CHANGED");
        await this.site("context", { context: d.context });
        d.recognitionNotices = [];
        let words = d.recognitionWords ?? [];
        for (const attachment of d.attachments) {
          const cells = pending.filter((r) =>
            r.observations.some((w) => w.attachmentId === attachment.id),
          );
          if (!cells.length) continue;
          const result = await this.ocr(await this.download(attachment.url), {
            roster: true,
            loot: false,
            scope: d.context.server,
            retryCells: cells.map((r) => ({ slotKey: r.key, box: r.box })),
          });
          if (result.notice) d.recognitionNotices.push(result.notice);
          const replacements = new Set(result.words.map((w) => w.slotKey));
          words = words
            .filter((w) => !replacements.has(w.slotKey))
            .concat(
              result.words.map((w) => ({
                ...w,
                attachmentId: attachment.id,
                line: attachment.id + ":" + w.line,
              })),
            );
        }
        // Only unresolved cells change. Confirmed corrections and ignored noise survive.
        const updated = recognizeIndependentRoster(words, d.catalog.members);
        const pendingKeys = new Set(pending.map((r) => r.key));
        for (const reading of d.roster.readings.filter(
          (r) => !pendingKeys.has(r.key),
        )) {
          const i = updated.readings.findIndex((r) => r.key === reading.key);
          if (i >= 0) updated.readings[i] = reading;
          else if (reading.origin === "manual-add")
            updated.readings.push(reading);
        }
        updated.members = [
          ...new Map(
            updated.readings
              .filter((r) => !r.pending && !r.ignored && r.memberId)
              .map((r) => [
                r.memberId,
                d.catalog.members.find((m) => m.id === r.memberId),
              ])
              .filter(([, m]) => m),
          ).values(),
        ];
        updated.guests = [
          ...new Set(
            updated.readings
              .filter((r) => !r.pending && !r.ignored && r.name && !r.memberId)
              .map((r) => r.name),
          ),
        ];
        updated.unresolved = updated.readings
          .filter((r) => r.pending && !r.ignored)
          .map((r) => r.visible || "Ник не прочитан");
        updated.unresolvedKeys = updated.readings
          .filter((r) => r.pending && !r.ignored)
          .map((r) => r.key);
        d.recognitionWords = words;
        d.roster = updated;
        d.rosterFocus = 0;
        d.step = "review";
      } else if (action === "reviewNames") {
        d.step = "names";
        d.namesPage = 0;
        d.nameReviewFocusKey = d.roster.readings?.[0]?.key;
      } else if (action === "readingFocus") {
        const r = d.roster.readings?.find(
          (r) => r.key.slice(0, 24) === interaction.values[0],
        );
        if (!r) throw Error("DRAFT_CHANGED");
        d.nameReviewFocusKey = r.key;
        d.step = "names";
      } else if (action === "nameprev" || action === "namenext") {
        d.namesPage = Math.max(
          0,
          Math.min(
            Math.ceil((d.roster.readings?.length ?? 0) / 25) - 1,
            (d.namesPage ?? 0) + (action === "nameprev" ? -1 : 1),
          ),
        );
        d.nameReviewFocusKey = d.roster.readings?.[d.namesPage * 25]?.key;
        d.step = "names";
      } else if (action === "rosterFocus") {
        const focus = Number(interaction.values[0]);
        if (
          !Number.isInteger(focus) ||
          focus < 0 ||
          focus >= d.roster.unresolved.length
        )
          throw Error("INVALID_INPUT");
        d.rosterFocus = focus;
        d.step = "review";
      } else if (action === "removeMember") {
        d.removePage = 0;
        d.step = "removeMember";
      } else if (action === "removePrev" || action === "removeNext") {
        d.removePage = Math.max(
          0,
          Math.min(
            Math.ceil(rosterParticipants(d).length / 25) - 1,
            (d.removePage ?? 0) + (action === "removePrev" ? -1 : 1),
          ),
        );
      } else if (action === "removePick") {
        const participant = rosterParticipants(d).find(
          (m) => m.value === interaction.values[0],
        );
        if (!participant) throw Error("DRAFT_CHANGED");
        excludeParticipant(d, participant);
        d.removePage = Math.max(
          0,
          Math.min(
            d.removePage ?? 0,
            Math.ceil(rosterParticipants(d).length / 25) - 1,
          ),
        );
        if (!rosterParticipants(d).length) d.step = "review";
      } else if (action === "memberPick" && d.memberSearchMode === "add") {
        const member = d.catalog.members.find(
          (m) => m.id === interaction.values[0],
        );
        if (!member) throw Error("INVALID_ROSTER");
        if (!d.roster.members.some((m) => m.id === member.id)) {
          d.roster.members.push(member);
          (d.roster.readings ??= []).push({
            key: "manual_" + randomUUID(),
            visible: "",
            name: member.nickname,
            memberId: member.id,
            pending: false,
            ignored: false,
            origin: "manual-add",
            status: "добавлен вручную",
            verifiedCell: false,
            engine: "manual",
            imageKey: "",
            variants: [],
            observations: [],
          });
        }
        d.step = "review";
      } else if (action === "rosterPick" || action === "memberPick") {
        if (action === "memberPick") {
          const index = d.memberSearchReadingKey
            ? d.roster.unresolvedKeys?.indexOf(d.memberSearchReadingKey)
            : d.roster.unresolved.indexOf(d.memberSearchRaw);
          if (index === undefined || index < 0) throw Error("DRAFT_CHANGED");
          d.rosterFocus = index;
        }
        const focus = Math.max(
            0,
            Math.min(d.roster.unresolved.length - 1, d.rosterFocus ?? 0),
          ),
          raw = d.roster.unresolved[focus];
        if (!raw) throw Error("INVALID_INPUT");
        const value = interaction.values[0];
        const reading = focusedReading(d, focus);
        let correction = null;
        if (value === "skip") {
          d.roster.unresolved.splice(focus, 1);
          d.roster.unresolvedKeys?.splice(focus, 1);
          if (reading) {
            reading.pending = false;
            reading.ignored = true;
            reading.status = "исключён вручную";
            if (reading.memberId)
              excludeParticipant(d, {
                memberId: reading.memberId,
                name: reading.name,
              });
            else if (reading.name && d.roster.guests.includes(reading.name))
              excludeParticipant(d, { name: reading.name });
          }
        } else {
          const member = [
              ...d.catalog.members,
              ...(d.knownNicknameChoices ?? []),
            ].find((m) => m.id === value),
            name = value === "guest" ? raw : member?.nickname;
          if (!name) throw Error("INVALID_ROSTER");
          correction = resolveReading(
            d,
            focus,
            name,
            value === "guest" ? "confirmed-guest" : "confirmed-selection",
          );
          if (correction && !(value === "guest" && reading?.truncated))
            this.store.rememberNicknames?.({
              scope: d.context.server,
              id: "pick:" + randomUUID(),
              source: d.message,
              actor: d.owner,
              names: [name],
              corrections: [correction],
            });
        }
        d.rosterFocus = Math.max(
          0,
          Math.min(focus, d.roster.unresolved.length - 1),
        );
        d.step = "review";
      } else if (action.startsWith("correctNick_")) {
        const key = action.slice("correctNick_".length),
          reading = d.roster.readings?.find((r) => r.key.slice(0, 24) === key),
          focus = key.startsWith("legacy_") ? Number(key.slice(7)) : -1;
        if (
          !reading &&
          (!Number.isInteger(focus) ||
            focus < 0 ||
            focus >= d.roster.unresolved.length)
        )
          throw Error("DRAFT_CHANGED");
        const name = gameNickname(
          interaction.fields.getTextInputValue("value"),
        );
        if (!name) throw Error("INVALID_NICKNAME");
        const correction = reading
          ? correctAnyReading(d, reading.key, name)
          : resolveReading(d, focus, name, "manual-correction");
        this.store.rememberNicknames?.({
          scope: d.context.server,
          id: "manual:" + randomUUID(),
          source: d.message,
          actor: d.owner,
          names: [name],
          corrections: correction ? [correction] : [],
        });
        d.knownNicknameChoices = memoryChoices(
          this.store.knownNicknames?.(d.context.server) ?? [],
        );
        d.nicknameRemembered = true;
        if (d.step !== "names") d.step = "review";
      } else if (action === "rostertext") {
        d.roster = manuallyReadRoster(
          interaction.fields.getTextInputValue("value"),
          d.catalog.members,
        );
        d.step = "review";
      } else if (action === "loottext") {
        d.rosterOnly = false;
        const text = interaction.fields.getTextInputValue("value");
        if (d.screensOnly) {
          d.lootOverride = text;
          d.lootOverrideImages = Object.keys(d.lootImageResults ?? {});
        }
        d.loot = recognizeLoot(text, d.catalog.drops);
        d.step = "review";
      } else if (action === "remember") {
        if (
          d.roster.unresolved.length ||
          !(d.roster.members.length + d.roster.guests.length)
        )
          throw Error("NAMES_NOT_CONFIRMED");
        const names = confirmedNames(d);
        if (!names.length) throw Error("FULL_NICKNAME_REQUIRED");
        this.store.rememberNicknames?.({
          scope: d.context.server,
          id:
            "review:" +
            d.request +
            ":" +
            createHash("sha256").update(JSON.stringify(names)).digest("hex"),
          source: d.message,
          actor: d.owner,
          names,
          corrections: confirmedExamples(d),
        });
        d.nicknameRemembered = true;
        d.step = "review";
      } else if (action === "confirm" || action === "confirmRosterOnly") {
        if (
          !d.activity ||
          !["raid", "pvp"].includes(d.mode) ||
          !["prime", "mini_rb"].includes(d.source)
        )
          throw Error("INVALID_INPUT");
        if (action === "confirmRosterOnly") d.rosterOnly = true;
        if (!d.analyzed) throw Error("RECOGNITION_REQUIRED");
        if (!d.roster.members.length || d.roster.unresolved.length)
          throw Error("ROSTER_CONFIRMATION_REQUIRED");
        d.step = "confirm";
      } else if (action === "backreview") d.step = "review";
      else if (action === "publish") {
        if (
          d.step !== "confirm" ||
          !reviewReady(d, {
            rosterOnly: d.rosterOnly === true,
            allowPendingLoot: true,
          })
        )
          throw Error("ROSTER_CONFIRMATION_REQUIRED");
        // Preserve the identical payload for retries after a lost response.
        if (!d.publication) {
          for (const item of d.loot.items)
            d.lootRequests[item.id] ??= randomUUID();
          d.publication = {
            context: d.context,
            message: d.message,
            request: d.request,
            activity: {
              title: d.activity.name,
              status: "completed",
              startsAt: d.startsAt,
              kind: d.mode,
              source: d.source,
              banner: d.activity.id,
              bannerVersion: d.activity.version,
              coefficient: (activityWeight(d) / 100).toFixed(2),
              reward: "0",
              difficulty: "normal",
              night: false,
              counts: true,
              confirmRoster: true,
              members: d.roster.members.map((m) => m.id),
              guests: d.roster.guests,
              description: activityDescription(d),
              evidence: d.rosterOnly
                ? d.evidence.filter((e) => e.kind === "roster")
                : d.evidence,
              loot: d.rosterOnly
                ? []
                : d.loot.items.map((item) => ({
                    id: item.id,
                    version: item.version,
                    quantity: item.quantity,
                    request_id: d.lootRequests[item.id],
                  })),
              facts: {},
            },
          };
          this.store.put(d);
        }
        d.event = await this.site("import", d.publication);
        d.savedAt ??= new Date().toISOString();
        try {
          this.store.rememberNicknames?.({
            scope: d.context.server,
            id: "event:" + d.event.event_id,
            source: d.message,
            actor: d.owner,
            names: confirmedNames(d),
            corrections: confirmedExamples(d),
          });
        } catch {
          d.nicknameMemoryFailed = true;
        }
      } else throw Error("INVALID_INPUT");
      if (action !== "publish") delete d.publication;
      this.store.put(d);
      await interaction.editReply(renderDraft(d));
    } catch (e) {
      const payload = { content: safeError(e), flags: 64 };
      if (interaction.deferred || interaction.replied) {
        if (acquired)
          try {
            await interaction.editReply(renderDraft(this.store.get(id)));
          } catch {}
        await interaction.followUp(payload).catch(() => {});
      } else await interaction.reply(payload).catch(() => {});
    } finally {
      if (acquired) this.locks.delete(id);
    }
  }
}
