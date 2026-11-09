# User activity coefficients and original banners — 2026-11-09

18 activities, exact coefficients in `20261109-activity-coefficients.tsv`. Integers use the site's actual coefficient scale (100 = 1.00); sum 1400. Original list's wrapped opening was read as AGL 0.5 and AGL T2 1.

Verified terminology against the official Russian publisher:

- «Кошка» is Разъяренная Сехекмет: https://archeage.ru/game/chas-padalshchikov/. Retained «Кошка» in the display name for discoverability and the established Mini-RB classification.
- «Жук» is Голиаф, механический скарабей, and «Калиель» is correctly Калеиль: https://archeage.ru/game/kaleil/.
- «Разъярённая Марля» normalized to Разъярённая Марли; the official legendary achievement also names the stronger boss Обращенная Марли: https://archeage.ru/game/talisman-legendarnogo-geroya/.
- AGL is represented by Glenn/Loreia from the official mythic opponents guide; AGL T2 uses the stronger variant from the official legendary achievement guide.

Each JSON record retains source page/image, original dimensions and SHA-256, focal crop, final PNG SHA-256 and name aliases. Most artwork/screenshots are from official ArcheAge Russian guides and promotions; Aviara uses the original 4Gamer press screenshot of the matching raid boss, rather than an unrelated mount. Goliath uses the official guide's raid preparation scene (not an image of a different mechanical mount). Native portraits of several stronger bosses have limited original resolution; no synthetic details were invented. Misidentified quest-interface, reward-buff and portal images were rejected during visual review. Final banners are browser-normalized PNG 480×180, as in the site's upload flow; focal points keep portraits' faces within the crop.

Import changes only requested guild_activity_banners rows and adds audit entries including complete prior rows and source provenance. It matches known aliases, rejects ambiguous existing names, checks versions and refuses to overwrite later manual edits on replay. Existing event snapshots, attendance, financial records and drop catalog are untouched.

The exact per-record SQL was executed on production-like PGlite without optional migrations 017/018: 18 names/images/coefficients match, 18 audit entries, idempotent replay, protection of later edits and Mini-RB alias classification. Site coefficient parser validated every TSV amount.
