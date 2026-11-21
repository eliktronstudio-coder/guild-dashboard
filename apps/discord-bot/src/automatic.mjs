// Automatic analysis shares the same draft, review and publication workflow as commands.
export function automaticImports({ flow, store, allowed, onError = () => {} }) {
  let queue = Promise.resolve();
  return async (message) => {
    if (
      !allowed(message.channel) ||
      message.author.bot ||
      ![...message.attachments.values()].some(
        (a) =>
          /^image\/(png|jpe?g|webp)$/i.test(a.contentType ?? "") ||
          /\.(png|jpe?g|webp)$/i.test(a.name ?? ""),
      )
    )
      return;
    if (!store.claimAutomaticMessage(message.guildId, message.id)) return;
    const task = queue.then(async () => {
      if (!allowed(message.channel)) return;
      const reply = await message.reply({
        content: "Распознаю скриншоты: первый — состав, остальные — дроп…",
        allowedMentions: { parse: [], repliedUser: false },
      });
      const edit = (payload) => {
        const { flags, ...publicPayload } = payload;
        return reply.edit({
          ...publicPayload,
          allowedMentions: { parse: [], repliedUser: false },
        });
      };
      await flow.start(
        {
          user: { id: message.author.id },
          guildId: message.guildId,
          channelId: message.channelId,
          channel: message.channel,
          deferred: true,
          replied: true,
          deferUpdate: async () => {},
          editReply: edit,
          reply: edit,
          followUp: edit,
        },
        message,
        { automatic: true },
      );
    });
    queue = task.catch(() => {
      onError();
    });
    return queue;
  };
}
