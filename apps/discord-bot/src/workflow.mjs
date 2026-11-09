import { randomUUID, createHash } from "node:crypto";
import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import {
  lootText,
  reviewReady,
  suggestion,
  nicknameSuggestions,
} from "./matching.mjs";
import { safeError } from "./site.mjs";
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
          "Далее: скриншоты",
          1,
          !d.activity || !d.mode || !d.source,
        ),
      ),
    ];
  }
  if (d.step === "images") {
    const options = d.attachments.map((a, i) => ({
      label: truncate(`${i + 1}. ${a.name}`, 100),
      value: a.id,
    }));
    return [
      ...(options.length
        ? [
            select(
              id("rosterImages"),
              "Скрины состава",
              options,
              d.rosterImages,
              Math.min(4, options.length),
              0,
            ),
            select(
              id("lootImages"),
              "Скрины дропа",
              options,
              d.lootImages,
              Math.min(4, options.length),
              0,
            ),
          ]
        : []),
      row(
        button(id("analyze"), "Распознать", 1),
        button(id("extra"), "Дроп из сообщения"),
        button(id("backchoose"), "Назад"),
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
        button(id("publish"), "Подтверждаю состав и дроп — сохранить", 3),
        button(id("backreview"), "Вернуться к проверке"),
      ),
    ];
  const focus = Math.max(
      0,
      Math.min(d.roster.unresolved.length - 1, d.rosterFocus ?? 0),
    ),
    unknown = d.roster.unresolved[focus],
    hints = unknown
      ? nicknameSuggestions(unknown, [
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
          { label: "Не участник / убрать шум", value: "skip" },
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
    ),
    row(
      button(id("editroster"), "Исправить состав"),
      ...(unknown ? [button(id("editnick"), "Исправить и запомнить ник")] : []),
      button(id("editloot"), "Исправить дроп"),
      button(
        id("remember"),
        "Запомнить проверенные ники",
        2,
        Boolean(d.roster.unresolved.length) ||
          !(d.roster.members.length + d.roster.guests.length),
      ),
      button(id("confirm"), "Сохранить на сайт", 3, !reviewReady(d)),
    ),
  ];
}
export function reviewText(d) {
  return [
    `Активность: ${d.activity.name}; ${d.mode === "pvp" ? "PvP" : "PvE"}; ${d.source === "prime" ? "Прайм" : "Мини-РБ"}; коэффициент ${(d.activity.weight / 100).toFixed(2)}`,
    `Дата сообщения: ${d.startsAt} UTC`,
    "",
    "Ники со скриншота (чтение независимо от сайта):",
    ...(d.roster.readings ?? []).map(
      (r) =>
        `${r.visible || "[не прочитан]"}${r.name ? " → " + r.name : ""}${r.origin === "memory" ? " [память исправлений]" : ""}${r.truncated ? " [обрезан на скрине]" : ""}`,
    ),
    "",
    "Состав:",
    ...d.roster.members.map((m) => m.nickname),
    ...d.roster.guests.map((n) => "гость: " + n),
    ...d.roster.unresolved.map((n) => "? " + n),
    "",
    "Дроп:",
    ...d.loot.items.map(
      (item) =>
        `${item.name} x${item.quantity} (${Number(item.price_units) / 10000} зол./ед.)`,
    ),
    ...d.loot.unresolved.map((n) => "? " + n),
  ].join("\n");
}
export function renderDraft(d) {
  let content;
  if (d.event)
    return {
      content: `Активность сохранена: ${d.event.url}\n${d.nicknameMemoryFailed ? "Память ников временно недоступна." : "Подтверждённые ники добавлены в память бота."}`,
      components: [],
      attachments: [],
    };
  if (d.step === "choose")
    content =
      "Выберите активность из реестра сайта, тип и источник. Данные пока не сохраняются на сайт.";
  else if (d.step === "images")
    content =
      "Укажите, где состав, а где дроп. Первое изображение предварительно выбрано как состав; проверьте выбор. Текст исходного сообщения будет разобран как список дропа. Если скринов нет, состав можно будет ввести вручную.";
  else if (d.step === "names")
    content =
      "Выберите любой прочитанный ник, даже уже распознанный. «Исправить и запомнить» сохраняет полный игровой ник и пример чтения. Наличие аккаунта на сайте не требуется.";
  else if (d.step === "confirm")
    content = `Подтвердите полный состав: ${d.roster.members.length} зарегистрированных игроков и ${d.roster.guests.length} гостей. Остальные подходящие участники сайта будут отмечены отсутствующими; гости не входят в статистику. Дроп: ${d.loot.items.length} позиций. Дата берётся из исходного сообщения. Начисления и выплаты не создаются.`;
  else {
    const tips = d.roster.unresolved.slice(0, 8).map((n) => {
      const match = suggestion(n, d.catalog.members);
      return match ? `${n} → возможно, ${match.nickname}` : n;
    });
    content = `${d.nicknameRemembered ? "Подтверждённые ники сохранены в памяти. Активность ещё не создана.\n" : ""}${d.activity.name} · ${d.mode === "pvp" ? "PvP" : "PvE"} · ${d.source === "prime" ? "Прайм" : "Мини-РБ"}\n${d.roster.detectedSlots ? "Ячеек рейда: " + d.roster.detectedSlots + ". " : ""}Сопоставлено с сайтом: ${d.roster.members.length}; гостей: ${d.roster.guests.length}. Дроп: ${d.loot.items.length} позиций.\nНе разобрано: ${d.roster.unresolved.length} ников, ${d.loot.unresolved.length} строк дропа.\n${tips.length ? "Проверьте: " + tips.join("; ") : ""}\nПолный список — в файле. Спорные ники выберите из подсказок ниже. Ники читаются независимо от сайта; игроки вне состава сохраняются гостями. «Исправить и запомнить ник» сохраняет ваше подтверждённое исправление для следующих скринов. Длинные ники на скрине могут быть обрезаны. Проверьте, что ни один участник не пропущен.`;
  }
  return {
    content: truncate(content, 1950),
    components: controls(d),
    attachments: [],
    ...(["review", "names"].includes(d.step)
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
  async start(interaction, message) {
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
      if (attachments.length > 4) throw Error("TOO_MANY_IMAGES");
      if (attachments.some((a) => a.size > 12 * 1024 * 1024))
        throw Error("IMAGE_TOO_LARGE");
      catalog.members = catalog.members.filter(
        (m) => new Date(m.joined_at).getTime() <= message.createdTimestamp,
      );
      const d = {
        id: randomUUID(),
        request: randomUUID(),
        owner: interaction.user.id,
        context,
        message: message.id,
        startsAt: new Date(message.createdTimestamp).toISOString().slice(0, 19),
        content: message.content,
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
      await interaction.editReply(renderDraft(d));
    } catch (e) {
      await interaction.editReply({ content: safeError(e), components: [] });
    }
  }
  async handle(interaction) {
    const [, id, action] = interaction.customId.split(":");
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
      if (
        ["activity", "mode", "source", "rosterImages", "lootImages"].includes(
          action,
        )
      ) {
        if (action === "activity")
          d.activity = d.catalog.activities.find(
            (a) => a.id === interaction.values[0],
          );
        else if (action === "rosterImages" || action === "lootImages") {
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
        d.step = "images";
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
      } else if (action === "analyze") {
        await interaction.editReply({
          content:
            "Читаю подписи ячеек рейда и сверяю с составом сайта… Это может занять до минуты.",
          components: [],
          attachments: [],
        });
        await this.site("context", { context: d.context });
        const knownNames = this.store.knownNicknames?.(d.context.server) ?? [];
        d.knownNicknameChoices = memoryChoices(knownNames);
        const words = [],
          lootLines = [d.content];
        d.evidence = [];
        for (const attachment of d.attachments) {
          if (
            !d.rosterImages.includes(attachment.id) &&
            !d.lootImages.includes(attachment.id)
          )
            continue;
          const buffer = await this.download(attachment.url),
            result = await this.ocr(buffer, {
              roster: d.rosterImages.includes(attachment.id),
              loot: d.lootImages.includes(attachment.id),
              members: d.catalog.members,
              drops: d.catalog.drops,
              knownNames,
            }),
            image = await this.prepareEvidence(buffer);
          if (d.rosterImages.includes(attachment.id)) {
            words.push(
              ...result.words.map((w) => ({
                ...w,
                line: attachment.id + ":" + w.line,
                ...(w.region !== undefined
                  ? { region: attachment.id + ":" + w.region }
                  : {}),
              })),
            );
            d.evidence.push({ id: randomUUID(), kind: "roster", image });
          }
          if (d.lootImages.includes(attachment.id)) {
            lootLines.push(result.text);
            d.evidence.push({ id: randomUUID(), kind: "loot", image });
          }
        }
        d.roster = recognizeIndependentRoster(words, d.catalog.members, {
          recall: (reading) =>
            this.store.recallNickname?.(d.context.server, reading) ?? {},
        });
        d.rosterFocus = 0;
        d.loot = lootText(lootLines.join("\n"), d.catalog.drops);
        d.analyzed = true;
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
      } else if (action === "rosterPick") {
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
        d.loot = lootText(
          interaction.fields.getTextInputValue("value"),
          d.catalog.drops,
        );
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
          corrections: [],
        });
        d.nicknameRemembered = true;
        d.step = "review";
      } else if (action === "confirm") {
        if (!reviewReady(d)) throw Error("ROSTER_CONFIRMATION_REQUIRED");
        d.step = "confirm";
      } else if (action === "backreview") d.step = "review";
      else if (action === "publish") {
        if (d.step !== "confirm" || !reviewReady(d))
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
              coefficient: (d.activity.weight / 100).toFixed(2),
              reward: "0",
              difficulty: "normal",
              night: false,
              counts: true,
              confirmRoster: true,
              members: d.roster.members.map((m) => m.id),
              guests: d.roster.guests,
              description: `Импорт из Discord: https://discord.com/channels/${d.context.server}/${d.context.channel}/${d.message}`,
              evidence: d.evidence,
              loot: d.loot.items.map((item) => ({
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
        try {
          this.store.rememberNicknames?.({
            scope: d.context.server,
            id: "event:" + d.event.event_id,
            source: d.message,
            actor: d.owner,
            names: confirmedNames(d),
            corrections: [],
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
