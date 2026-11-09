import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import {
  rosterText,
  recognizeRoster,
  lootText,
  reviewReady,
  suggestion,
} from "./matching.mjs";
import { safeError } from "./site.mjs";
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
  if (d.step === "confirm")
    return [
      row(
        button(id("publish"), "Подтверждаю состав и дроп — сохранить", 3),
        button(id("backreview"), "Вернуться к проверке"),
      ),
    ];
  return [
    row(
      button(id("editroster"), "Исправить состав"),
      button(id("editloot"), "Исправить дроп"),
      button(id("confirm"), "Сохранить на сайт", 3, !reviewReady(d)),
    ),
  ];
}
export function reviewText(d) {
  return [
    `Активность: ${d.activity.name}; ${d.mode === "pvp" ? "PvP" : "PvE"}; ${d.source === "prime" ? "Прайм" : "Мини-РБ"}; коэффициент ${(d.activity.weight / 100).toFixed(2)}`,
    `Дата сообщения: ${d.startsAt} UTC`,
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
      content: `Активность сохранена: ${d.event.url}`,
      components: [],
      attachments: [],
    };
  if (d.step === "choose")
    content =
      "Выберите активность из реестра сайта, тип и источник. Данные пока не сохраняются на сайт.";
  else if (d.step === "images")
    content =
      "Укажите, где состав, а где дроп. Первое изображение предварительно выбрано как состав; проверьте выбор. Текст исходного сообщения будет разобран как список дропа. Если скринов нет, состав можно будет ввести вручную.";
  else if (d.step === "confirm")
    content = `Подтвердите полный состав: ${d.roster.members.length} зарегистрированных игроков и ${d.roster.guests.length} гостей. Остальные подходящие участники сайта будут отмечены отсутствующими; гости не входят в статистику. Дроп: ${d.loot.items.length} позиций. Дата берётся из исходного сообщения. Начисления и выплаты не создаются.`;
  else {
    const tips = d.roster.unresolved.slice(0, 8).map((n) => {
      const match = suggestion(n, d.catalog.members);
      return match ? `${n} → возможно, ${match.nickname}` : n;
    });
    content = `${d.activity.name} · ${d.mode === "pvp" ? "PvP" : "PvE"} · ${d.source === "prime" ? "Прайм" : "Мини-РБ"}\nРаспознано участников: ${d.roster.members.length}; гостей: ${d.roster.guests.length}. Дроп: ${d.loot.items.length} позиций.\nНе разобрано: ${d.roster.unresolved.length} ников, ${d.loot.unresolved.length} строк дропа.\n${tips.length ? "Проверьте: " + tips.join("; ") : ""}\nПолный список — в приложенном файле. Исправьте строки с «?», удалите шум или укажите «гость: Ник». Проверьте, что ни один участник не пропущен.`;
  }
  return {
    content: truncate(content, 1950),
    components: controls(d),
    attachments: [],
    ...(d.step === "review"
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
        await this.site("context", { context: d.context });
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
            result = await this.ocr(buffer),
            image = await this.prepareEvidence(buffer);
          if (d.rosterImages.includes(attachment.id)) {
            words.push(...result.words);
            d.evidence.push({ id: randomUUID(), kind: "roster", image });
          }
          if (d.lootImages.includes(attachment.id)) {
            lootLines.push(result.text);
            d.evidence.push({ id: randomUUID(), kind: "loot", image });
          }
        }
        d.roster = recognizeRoster(words, d.catalog.members);
        d.loot = lootText(lootLines.join("\n"), d.catalog.drops);
        d.analyzed = true;
        d.step = "review";
      } else if (action === "rostertext") {
        d.roster = rosterText(
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
      } else throw Error("INVALID_INPUT");
      if (action !== "publish") delete d.publication;
      this.store.put(d);
      await interaction.editReply(renderDraft(d));
    } catch (e) {
      const payload = { content: safeError(e), flags: 64 };
      if (interaction.deferred || interaction.replied)
        await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    } finally {
      if (acquired) this.locks.delete(id);
    }
  }
}
