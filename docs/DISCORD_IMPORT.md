# Discord activity import

The bot integrates the established XD web/Supabase stack. It uses Discord.js and local Tesseract OCR (`rus+eng`), without an LLM API, external OCR service or paid model. Treat OCR as a draft: confidence and exact registry matches determine suggestions, never authoritative attendance. A real Discord application/token and server installation are still necessary; deploying code alone does not connect a Discord account.

## Connect a new bot

1. Open Discord Developer Portal → Applications → New Application → Bot. Enable **Message Content Intent** and generate its token. Do not paste tokens into GitHub issues or chat.
2. Open `https://xd-guild.ru/admin/discord` as a website administrator. Enter server ID, activity channel ID and the new bot token. Enable import. Tokens are verified using Discord's read-only `users/@me` endpoint and encrypted using AES-256-GCM before storage in the private schema. They are not returned to the browser.
3. Install the application into the guild using Guild Install, `bot` + `applications.commands`. Grant only View Channels, Send Messages, Send Messages in Threads, Read Message History, Attach Files and Embed Links. No administrator permission is needed. The site displays an invite link after the worker first connects.
4. Any Discord guild participant with access to the configured channel can start and confirm an import. No website account, individual Discord binding or staff role is required. The connection delegates the administrator who enabled it; existing website permissions are never granted to Discord users. Every context read and publication checks the allowed server/channel and the active connection owner. The actual confirming Discord user ID is retained in import provenance.
5. Post raid screenshots and loot text in the configured channel. Forum threads are accepted only under the configured parent. Use **Разобрать активность**, the message context menu **Добавить на сайт**, or `/activity message_id:...` for an existing message. The bot does not backfill channel history automatically.

## Review and publish

Choose activity (current website banner registry), PvP/PvE, Prime/Mini-RB, then classify up to four attached PNG/JPEG/WebP screenshots as roster or loot. Text in the original message is parsed as loot. If loot was posted separately in the same channel, use **Дроп из сообщения** and enter that message ID before recognition. OCR runs only after an channel participant starts it. New screenshots are prepared as bounded JPEG evidence for the existing private galleries.

Only unique exact roster matches with sufficient OCR confidence are preselected. Correct uncertain lines or remove OCR noise. `гость: Ник` explicitly adds an informational guest; guests never affect attendance. Review the full attached text file, including the names OCR missed. Correct loot with one `Название xКоличество` per line; named essence packs are distinguished from quantities. Unknown items never create catalog entries. Prices and coefficients come from versioned website catalogs, with conflicts blocking publication. For particularly dense screenshots, enter the roster manually in the correction dialog (Discord field limit: 4000 characters).

The final confirmation explicitly states that unselected eligible members will be absent. The original message timestamp is the event date (UTC); future events cannot be imported as completed. Guests, roster screenshots and loot screenshots retain existing site privacy. Empty/uncertain rosters cannot publish. The bot does not infer achievement facts, sell inventory or create awards/payouts.

The service wrapper delegates only a active administrator who enabled the channel connection for the duration of one service-role transaction; existing `record_activity`, catalog snapshots, attendance confirmation, inventory checks and audits execute unchanged. Browser JWTs cannot activate delegation. Provenance identifies server/channel/message and confirming Discord user. One source message can create only one activity; identical retries return the same event, changed payloads conflict.

## Deployment

Apply migrations 023 and 024 before the web release. Generate a strong server-only `DISCORD_IMPORT_SECRET` shared by web and worker, never a `NEXT_PUBLIC_` variable. Worker API routes use constant-time bearer authentication, bounded bodies, private/no-store responses and service-only database functions. The worker receives only its narrowly scoped bridge credential, not the Supabase service key. API runtime responses containing a bot token are never cached.

Install Tesseract and the Russian/English language packages, run the worker with Node >=22.13, install `deploy/xd-discord-bot.service` as a dedicated `xd-discord` OS user, and place its environment in `/etc/xd-discord-bot.env` (root 0600). The bot waits while site configuration is disabled or missing. State is a private SQLite file in `/var/lib/xd-discord-bot`, with 24-hour draft expiry, stable publication IDs and restart recovery. This SQLite file holds only bot drafts, not the application's database. Polling refreshes configuration every 30 seconds. Disabling channel settings stops further imports immediately. Blocking/removing the connection owner or revoking their required permissions also stops imports until an administrator saves the connection again.

`scripts/deploy-discord-timeweb.sh` installs an isolated versioned release, tests it, switches atomically and restarts the worker. The existing web deployment invokes it when the worker service is installed, so future foundation-branch updates deploy both. The web service remains on port 3001 and Supabase; the unrelated old SQLite website is not involved.

## Validation

`npm --prefix apps/web run check`: SQL migration, channel delegation boundary, normal browser isolation, forum scope, exact inventory/attendance/audit, replay and existing regression checks.

`npm --prefix apps/discord-bot test`: uncertain OCR matches, loot quantities, persistent drafts, ownership/locking, full review/publication protocol and lost-response retry. Real OCR smoke uses a synthetic Russian/English image and validates bounded JPEG preparation. Final live guild permissions, actual screenshots and gateway delivery must be accepted after the real Discord application is connected; no real Discord messages are sent during isolated tests.

## Small raid-name labels

The roster recognizer detects repeated blue/pink raid panels, removes borders, isolates each name label and builds padded OCR sheets. Grayscale and white-text treatments are read independently with Russian, English and combined models. Bounded local dictionaries use the current member names (and drop names for loot images). High-accuracy Tesseract models are pinned to an upstream commit and verified by SHA-256 by `scripts/install-discord-ocr-models.sh`; they are not bundled into the repository. Each OCR image has a 90-second deadline and Tesseract uses one thread.

A uniquely matching visible nickname prefix can recover an ellipsized registered name. Visual Cyrillic/Latin lookalikes are handled without accepting ambiguous registry collisions. Fuzzy-only readings stay pending. Low-confidence exact readings require cross-treatment corroboration. Unknown cells remain visible even if OCR read nothing. Review now provides dropdown suggestions and explicit guest/noise actions, while the full roster remains editable. Detecting a cell is not proof of a registered participant: an unregistered or truncated unknown name cannot be reconstructed from a website roster that does not contain it.

Acceptance on the user's reported 360×262 raid image: 27 cells detected; 9 of 10 visually identified registered nicknames matched automatically, with no extra registered names selected, compared with 0 before the fix. The remaining registered name is ambiguous and must be selected by the user. This is a single-image regression check, not a general accuracy claim. The private screenshot and member dictionary were used locally and were not committed to the repository. Other nonregistered players still require explicit guest/name review.

## Independent nickname reading and correction memory

Nickname extraction is separate from website membership lookup. Each cell retains its visible reading, alternatives, confidence and clipping flag even when no website account matches it. Unregistered full names supported by independent OCR passes are proposed as informational guests; ambiguous and clipped names require review. Raw image readings appear separately in the review file. At least one OCR treatment ignores the registry dictionary, and stored game nicknames can help later dictionary-assisted passes without creating website accounts.

Use **Проверить все прочитанные ники** to correct any cell, including a name already accepted as a guest or registered player. **Исправить и запомнить ник** accepts the full game nickname regardless of website membership. A confirmed correction stores the full nickname, observed text variants, source/confirming Discord user, image hash and cell position key. Image pixels are not stored in this persistent memory. **Запомнить проверенные ники** also confirms a fully reviewed name list without creating a website activity, so a guest-only list can be remembered. Successful activity publication remembers confirmed full names as well; a memory failure never hides an already created activity.

This is persistent correction memory and a recognition dictionary, **not neural-network weight training**. Memory lives alongside private drafts in the existing worker SQLite database and is separated by Discord guild. An exact previously corrected image/cell can reuse its correction immediately. Global text aliases need at least two distinct source images; repeated copies do not increase that evidence. Conflicting mappings remain ambiguous, with remembered names offered as suggestions. Lists are bounded (5000 stored names and 50000 text examples per guild; the OCR dictionary uses 2000 recent names). Names are retained until forgotten or displaced by those bounds; draft expiry does not erase learned names.

Administrators with Discord **Manage Server** permission can use `/nickname-memory` for counts or `/nickname-memory forget:<full nickname>` to delete a wrong name and its associated examples. This does not require extra permissions for the bot itself. Existing website accounts, attendance rules and financial operations remain unchanged. Guest names are informational and never receive attendance percentages or payouts. Entirely hidden or clipped unknown letters still cannot be inferred reliably without a confirmed example or human input.

## Saving composition without loot

Choose **Только состав — без дропа** before recognition to skip caption-as-loot parsing and loot-only images. After any full recognition, **Сохранить состав без дропа** can also defer the loot stage, including unknown loot lines. The roster still requires normal review and explicit confirmation; this does not bypass unknown nicknames or change attendance eligibility.

The publication contains no inventory items or loot screenshots in this mode. Registered attendance, guests, the roster screenshot, activity/source and coefficient are saved as usual. A full-recognition draft retains its original recognized/unknown loot for review; it is not silently recorded or declared sold. Loot can be added later using the existing activity card controls by a user with the appropriate inventory permissions. Editing the loot explicitly switches the draft back to the full mode. No schema changes are required.
