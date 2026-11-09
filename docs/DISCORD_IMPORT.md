# Discord activity import

The bot integrates the established XD web/Supabase stack. It uses Discord.js and local Tesseract OCR (`rus+eng`), without an LLM API, external OCR service or paid model. Treat OCR as a draft: confidence and exact registry matches determine suggestions, never authoritative attendance. A real Discord application/token and server installation are still necessary; deploying code alone does not connect a Discord account.

## Connect a new bot

1. Open Discord Developer Portal → Applications → New Application → Bot. Enable **Message Content Intent** and generate its token. Do not paste tokens into GitHub issues or chat.
2. Open `https://xd-guild.ru/admin/discord` as a website administrator. Enter server ID, activity channel ID and the new bot token. Enable import. Tokens are verified using Discord's read-only `users/@me` endpoint and encrypted using AES-256-GCM before storage in the private schema. They are not returned to the browser.
3. Install the application into the guild using Guild Install, `bot` + `applications.commands`. Grant only View Channels, Send Messages, Send Messages in Threads, Read Message History, Attach Files and Embed Links. No administrator permission is needed. The site displays an invite link after the worker first connects.
4. Bind the importing employee's Discord User ID to their existing website membership. They must currently hold `events.manage`, `attendance.manage` and `treasury.manage`. Every context read and publication rechecks membership, permissions, block status and allowed server/channel.
5. Post raid screenshots and loot text in the configured channel. Forum threads are accepted only under the configured parent. Use **Разобрать активность**, the message context menu **Добавить на сайт**, or `/activity message_id:...` for an existing message. The bot does not backfill channel history automatically.

## Review and publish

Choose activity (current website banner registry), PvP/PvE, Prime/Mini-RB, then classify up to four attached PNG/JPEG/WebP screenshots as roster or loot. Text in the original message is parsed as loot. If loot was posted separately in the same channel, use **Дроп из сообщения** and enter that message ID before recognition. OCR runs only after an authorized employee starts it. New screenshots are prepared as bounded JPEG evidence for the existing private galleries.

Only unique exact roster matches with sufficient OCR confidence are preselected. Correct uncertain lines or remove OCR noise. `гость: Ник` explicitly adds an informational guest; guests never affect attendance. Review the full attached text file, including the names OCR missed. Correct loot with one `Название xКоличество` per line; named essence packs are distinguished from quantities. Unknown items never create catalog entries. Prices and coefficients come from versioned website catalogs, with conflicts blocking publication. For particularly dense screenshots, enter the roster manually in the correction dialog (Discord field limit: 4000 characters).

The final confirmation explicitly states that unselected eligible members will be absent. The original message timestamp is the event date (UTC); future events cannot be imported as completed. Guests, roster screenshots and loot screenshots retain existing site privacy. Empty/uncertain rosters cannot publish. The bot does not infer achievement facts, sell inventory or create awards/payouts.

The service wrapper delegates only a mapped active staff account for the duration of one service-role transaction; existing `record_activity`, catalog snapshots, attendance confirmation, inventory checks and audits execute unchanged. Browser JWTs cannot activate delegation. Provenance identifies server/channel/message and confirming Discord user. One source message can create only one activity; identical retries return the same event, changed payloads conflict.

## Deployment

Apply migration 023 before the web release. Generate a strong server-only `DISCORD_IMPORT_SECRET` shared by web and worker, never a `NEXT_PUBLIC_` variable. Worker API routes use constant-time bearer authentication, bounded bodies, private/no-store responses and service-only database functions. The worker receives only its narrowly scoped bridge credential, not the Supabase service key. API runtime responses containing a bot token are never cached.

Install Tesseract and the Russian/English language packages, run the worker with Node >=22.13, install `deploy/xd-discord-bot.service` as a dedicated `xd-discord` OS user, and place its environment in `/etc/xd-discord-bot.env` (root 0600). The bot waits while site configuration is disabled or missing. State is a private SQLite file in `/var/lib/xd-discord-bot`, with 24-hour draft expiry, stable publication IDs and restart recovery. This SQLite file holds only bot drafts, not the application's database. Polling refreshes configuration every 30 seconds. Revoking a staff mapping or disabling settings prevents further imports immediately at the database boundary.

`scripts/deploy-discord-timeweb.sh` installs an isolated versioned release, tests it, switches atomically and restarts the worker. The existing web deployment invokes it when the worker service is installed, so future foundation-branch updates deploy both. The web service remains on port 3001 and Supabase; the unrelated old SQLite website is not involved.

## Validation

`npm --prefix apps/web run check`: SQL migration, staff delegation boundary, normal browser isolation, forum scope, exact inventory/attendance/audit, replay and existing regression checks.

`npm --prefix apps/discord-bot test`: uncertain OCR matches, loot quantities, persistent drafts, ownership/locking, full review/publication protocol and lost-response retry. Real OCR smoke uses a synthetic Russian/English image and validates bounded JPEG preparation. Final live guild permissions, actual screenshots and gateway delivery must be accepted after the real Discord application is connected; no real Discord messages are sent during isolated tests.
