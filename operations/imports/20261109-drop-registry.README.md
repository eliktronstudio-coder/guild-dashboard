# User-provided drop registry, 2026-11-09

75 exact labels and prices supplied by the user, including 13 zero prices. Original input: `20261109-user-prices.tsv`. Prices use the application's gold scale of 10,000 integer units per gold; validated against its real `parseGold` and `goldInput` helpers.

Images come from matching Russian ArcheAge Codex item records. Each payload entry retains the source item page, original PNG URL, SHA-256 and native dimensions. Original game icons are 40×40 or 48×48 and are preserved without generated details or artificial enlargement. Six malformed backslash paths for Iza equipment/cloak were corrected to the actual image paths; generic empty-frame placeholders were rejected. Duplicate glider records use the same original images. Essence variants preserve the user's literal suffixes and prices and share the original essence icon.

`operations/scripts/import-drop-registry.py` verifies the live service's APP_ORIGIN and derives the Supabase project from that service. It matches existing normalized names, rejects ambiguity, checks versions, locks the catalog and applies one transaction. It changes only this guild's requested catalog rows and adds audit entries with image provenance and complete prior rows for rollback. Existing unrelated entries and financial records remain untouched. A completed import cannot replay over later manual edits.

Validation: the actual SQL was executed against PGlite with the deployed migration sequence (without optional 017/018). Verified 75 rows, 75 images, 13 zero prices, exact sum 2,146,895 gold, 75 audit records, correct money conversion and replay rejection.
