import { gameNickname } from "./nickname-memory.mjs";
export const RENAME_CHANNEL = "1211335490024771674";
export function parseRename(content) {
  if (
    typeof content !== "string" ||
    content.length > 150 ||
    /[\r\n]/u.test(content)
  )
    return null;
  const parts = content.trim().split(/\s+(?:-|—|–|→|->)\s+/u);
  if (parts.length !== 2) return null;
  const oldName = gameNickname(parts[0]),
    newName = gameNickname(parts[1]);
  return oldName && newName && oldName !== newName
    ? { oldName, newName }
    : null;
}
export function automaticRenames({ site, server, store, onError = () => {} }) {
  const pending = new Set();
  return async (message) => {
    if (
      message.author?.bot ||
      message.webhookId ||
      message.guildId !== server() ||
      message.channelId !== RENAME_CHANNEL ||
      pending.has(message.id)
    )
      return;
    pending.add(message.id);
    let accepted = false;
    try {
      const names = parseRename(message.content);
      if (!names) throw Error("INVALID_RENAME");
      await site("rename", {
        context: {
          server: message.guildId,
          channel: message.channelId,
          user: message.author.id,
        },
        message: message.id,
        ...names,
      });
      accepted = true;
      try {
        store?.forgetNickname(message.guildId, names.oldName);
      } catch {
        onError(Error("RENAME_MEMORY_UPDATE_FAILED"));
      }
    } catch (error) {
      onError(error);
    }
    try {
      const previous = message.reactions?.cache?.find(
        (r) => r.emoji.name === (accepted ? "❌" : "✅"),
      );
      if (previous?.me) await previous.users.remove(message.client.user.id);
      await message.react(accepted ? "✅" : "❌");
    } catch {
      onError(Error("RENAME_REACTION_FAILED"));
    } finally {
      pending.delete(message.id);
    }
  };
}
