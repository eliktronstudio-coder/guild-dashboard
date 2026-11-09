# Activity workspace

The `/events` journal uses `activity_journal` with 15 rows per page and filters over a UTC period of at most 366 days. Attendance percentages use the existing applicable roster and explicit confirmation; guests never enter statistics. The optional calendar shows the current journal page.

New and existing activity forms support catalog banner snapshots, coefficient, difficulty, night flag, registered participants, informational guests, drop quantities, confirmed achievement facts and private screenshots. Planned attendance gold is a quote only: it never creates awards or payouts. Payment statuses derive from active treasury awards and payments.

Apply `apps/web/supabase/migrations/202611090021_activity_workspace.sql` before deploying. This additive migration supports production migrations 001–016, 019 and 020 without requiring optional financial migrations 017/018. It preserves existing events and financial history. Cancelling is audited and retains the event; inventory with sale history cannot be deleted through the activity form.

Roster data and screenshots require attendance management permission. Loot screenshots require treasury read permission. Media routes check membership, guild, event and permission on every request and return private, uncached images. Screenshots are prepared in the browser and bounded by both SQL and server validation. The reverse proxy must allow 8 MB requests; Next server actions allow 6 MB.

Validation: `npm --prefix apps/web run check` exercises native PostgreSQL-compatible migrations, permissions, rollback, idempotence, real payment status and existing regression tests. `python3 apps/web/scripts/check-activity-workspace.py` exercises the production Next server with an isolated authenticated fixture, responsive themes, real server actions, screenshots and private media. It does not write production records.
