import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  ApplicationCommandType,
  ApplicationCommandOptionType,
} from "discord.js";
import { siteClient } from "./site.mjs";
import { draftStore } from "./store.mjs";
import { ImportWorkflow } from "./workflow.mjs";
import { downloadImage, ocr, prepareEvidence } from "./ocr.mjs";
const origin = process.env.XD_SITE_ORIGIN ?? "https://xd-guild.ru",
  secret = process.env.DISCORD_IMPORT_SECRET ?? "";
if (secret.length < 32) throw Error("DISCORD_IMPORT_SECRET is not configured");
const site = siteClient(origin, secret),
  store = draftStore(process.env.XD_DISCORD_STATE ?? "/var/lib/xd-discord-bot");
const flow = new ImportWorkflow({
  site,
  store,
  download: downloadImage,
  ocr,
  prepareEvidence,
  fetchMessage: async (context, id) => {
    const channel = await client.channels.fetch(context.channel);
    if (!allowed(channel)) throw Error("DISCORD_CHANNEL_FORBIDDEN");
    return channel.messages.fetch(id);
  },
});
let client = null,
  fingerprint = "",
  current = null,
  polling = false;
function allowed(channel) {
  return (
    channel?.guildId === current?.server &&
    (channel.id === current.channel ||
      (channel.isThread?.() && channel.parentId === current.channel))
  );
}
async function connect(config) {
  if (client) {
    client.destroy();
    client = null;
  }
  current = config;
  const next = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    allowedMentions: { parse: [] },
  });
  client = next;
  async function register() {
    try {
      const rest = new REST({ version: "10" }).setToken(config.token);
      await rest.put(
        Routes.applicationGuildCommands(next.application.id, config.server),
        {
          body: [
            { name: "Добавить на сайт", type: ApplicationCommandType.Message },
            {
              name: "activity",
              description:
                "Добавить активность на сайт из сообщения этого канала",
              options: [
                {
                  type: ApplicationCommandOptionType.String,
                  name: "message_id",
                  description:
                    "ID сообщения со скрином состава и списком дропа",
                  required: true,
                },
              ],
            },
          ],
        },
      );
    } catch {
      console.error(
        "Discord command registration unavailable; check installation and guild ID",
      );
    }
  }
  next.once("clientReady", async () => {
    console.log("Discord bot connected");
    await site("runtime", null, next.application.id).catch(() => {});
    await register();
  });
  next.on("guildCreate", (guild) => {
    if (guild.id === config.server) void register();
  });
  next.on("messageCreate", async (message) => {
    if (
      !allowed(message.channel) ||
      message.author.bot ||
      (!message.attachments.size && !message.content.trim())
    )
      return;
    try {
      await message.reply({
        content:
          "Добавить состав рейда и дроп на xd-guild.ru? Сотрудник с доступом может начать разбор.",
        allowedMentions: { parse: [], repliedUser: false },
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 1,
                custom_id: "xdstart:" + message.id,
                label: "Разобрать активность",
              },
            ],
          },
        ],
      });
    } catch {
      console.error("Cannot reply in configured activity channel");
    }
  });
  next.on("interactionCreate", async (interaction) => {
    try {
      const channel =
        interaction.channel ??
        (await next.channels.fetch(interaction.channelId));
      if (!allowed(channel))
        return interaction.reply({
          content:
            "Импорт доступен только в настроенном канале «Активность» и его ветках.",
          flags: 64,
        });
      if (
        interaction.isMessageContextMenuCommand() &&
        interaction.commandName === "Добавить на сайт"
      )
        await flow.start(interaction, interaction.targetMessage);
      else if (
        interaction.isChatInputCommand() &&
        interaction.commandName === "activity"
      ) {
        const id = interaction.options.getString("message_id", true);
        if (!/^\d{17,22}$/.test(id))
          return interaction.reply({
            content: "Укажите ID исходного сообщения.",
            flags: 64,
          });
        await interaction.deferReply({ flags: 64 });
        const message = await interaction.channel.messages.fetch(id);
        await flow.start(interaction, message);
      } else if (
        interaction.isButton() &&
        interaction.customId.startsWith("xdstart:")
      ) {
        await interaction.deferReply({ flags: 64 });
        const message = await interaction.channel.messages.fetch(
          interaction.customId.split(":")[1],
        );
        await flow.start(interaction, message);
      } else if (
        (interaction.isButton() ||
          interaction.isStringSelectMenu() ||
          interaction.isModalSubmit()) &&
        interaction.customId.startsWith("xd:")
      )
        await flow.handle(interaction);
    } catch {
      const content =
        "Не удалось прочитать сообщение. Проверьте канал, историю сообщений и доступ бота.";
      if (!interaction.replied && !interaction.deferred)
        await interaction.reply({ content, flags: 64 }).catch(() => {});
      else
        await interaction
          .editReply({ content, components: [] })
          .catch(() => {});
    }
  });
  next.on("error", () => console.error("Discord connection error"));
  next.on("shardError", () =>
    console.error("Discord gateway temporarily unavailable"),
  );
  try {
    await next.login(config.token);
  } catch {
    next.destroy();
    if (client === next) client = null;
    fingerprint = "";
    console.error(
      "Discord login unavailable; check token and Message Content Intent",
    );
  }
}
async function poll() {
  if (polling) return;
  polling = true;
  try {
    const config = await site(
      "runtime",
      null,
      client?.isReady() ? client.application.id : undefined,
    );
    if (!config.enabled) {
      if (client) client.destroy();
      client = null;
      fingerprint = "";
      current = null;
      return;
    }
    const value = JSON.stringify(config);
    if (value !== fingerprint || !client) {
      fingerprint = value;
      await connect(config);
    }
  } catch {
    console.error("Waiting for site configuration or connectivity");
  } finally {
    polling = false;
  }
}
await poll();
const timer = setInterval(poll, 30000);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    clearInterval(timer);
    client?.destroy();
    store.close();
    process.exit(0);
  });
