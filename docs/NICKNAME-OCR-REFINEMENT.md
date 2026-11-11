# Nickname OCR refinement

The local Tesseract pipeline keeps antialiased white-text intensities when
extracting blue/pink raid panels. The previous hard threshold ran before
enlargement and removed faint strokes from tiny letters. Ordinary language
dictionaries are disabled for roster OCR; the player vocabulary remains a hint.
Loot recognition keeps its existing settings.

After the sheet passes, only unresolved cells and tentative new guests are read
again as individual lines (PSM 7), using both image treatments without a player
dictionary. Retries keep the original pixel/slot identifiers and observations.
At most 12 cells and 24 seconds are retried, within the existing overall deadline;
individual reads have a three-second limit. A failed or timed-out retry preserves
the primary readings. The existing one-at-a-time OCR concurrency limit remains.

Names resembling registered players are held for review instead of silently
becoming new guests. Unknown names shorter than four letters require review.
Dictionary-only matches cannot select a player without independent image
evidence. Review suggestions use all OCR alternatives, not only the strongest
single reading. Ambiguous prefixes and fuzzy-only readings still require a human.

The explicit “remember” and final publication actions now save OCR examples for
confirmed, non-truncated registered-player cells and explicit manual corrections.
They do not train from pending, ignored, memory-derived or uncorrected guest
guesses. Existing SQLite memory, scope isolation, conflict detection and the
two-distinct-images threshold are retained. No neural model is retrained and no
new external AI service receives screenshots.

Validation: 27 bot tests cover faint glyph extraction, bounded retries, timeout
preservation, candidate alternatives, dictionary bias, guest ambiguity and
learning from explicit approval. The optional `scripts/benchmark-ocr.mjs` runs
real pinned Tesseract models on synthetic blue/pink panels with Russian/English
names, 9/11 px fonts, 55/82 px cards and JPEG compression. Across those 48 cells,
the previous build matched 42 correctly, guessed one wrong guest and left five
pending; this build matches 43 correctly, guesses none wrong and leaves five
pending. These synthetic results are not an accuracy estimate for actual raids.
Original Discord screenshots are needed for further real-world calibration.
