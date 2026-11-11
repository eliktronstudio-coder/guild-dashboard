# Required player class

Migration 039 adds `memberships.player_class` and `class_selected_at`. The allowed values are Лучник, Маг, Милик, Танк and Хил. Migration 041
adds Хил without resetting any saved selections. Existing memberships are left
NULL intentionally, even if a character already has a class: every existing
player explicitly selects once. No account, character, attendance or treasury
record is replaced or deleted.

Email registration validates `playerClass` before Auth account creation. The
Auth insert trigger independently validates and captures `game_class` in the
private registration intent. Enrollment uses that captured value, or the
explicit choice on the onboarding form for an older unfinished registration.
The old enrollment function is renamed and revoked; only the class-validating
wrapper is exposed to authenticated clients. Consent, unique nicknames/logins
and assignment of only the member role remain in the existing implementation.

An active member without `class_selected_at` sees the native modal dialog in
GuildShell. Escape cannot dismiss it, and its form requires one of the five
radio choices. Save checks origin, current active membership and the enum again.
The RPC accepts no member ID: it only changes the caller's membership, checks
current blocking/revocation, locks the guild, and records an audit entry. An
identical retry is a no-op; a conflicting selection from another tab does not
overwrite the first saved choice. Failed saves preserve the selected radio.

The timestamp in the database controls prompt visibility, not cookies or local
storage. A successful save refreshes the shared layout. The selected class is
shown in member_directory, the profile and activity roster; existing character
class values remain available and are used as a fallback until selection.

Validation: player-class native tests exercise missing/invalid classes,
registration intent, legacy enrollment, permissions, revocation, blocking,
idempotency and caller isolation. `scripts/check-player-class.py` checks the
production build against local fixtures on mobile and desktop, including failed
saves and persistence across routes, reloads and a fresh browser context.
