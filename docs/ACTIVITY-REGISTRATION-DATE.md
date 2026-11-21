# Recording raids before website registration

Migration 040 removes the registration-time condition from explicit roster
selection. Current active members of the same guild can be selected for an
earlier activity. Before marking a completed event, the save function inserts
missing attendance rows for those selected members, then applies the existing
audited mark and automatic-counting functions. Removing only the validation
condition would have saved the event without recording those selected players.

Existing attendance and payroll calculations already count explicit attendance
rows before membership registration. The change therefore records actual
participation correctly without rewriting membership dates or manufacturing
absence rows for unrelated late registrants. Existing rows, immutable archives,
closed-period guards, activity permissions, active membership checks and tenant
isolation remain unchanged. No existing activity, payout or attendance is
backfilled by the migration.

The Discord draft catalog also keeps all current members instead of filtering
them by the original message timestamp. A historical screenshot can now match
a player who registered on the website later. User-facing errors and attendance
help no longer describe registration time as a restriction.

Native tests exercise creation, edits, saved marks, 100% actual participation,
idempotent retries, excluded unrelated newcomers, inactive/foreign/unknown
members, missing write permissions and closed-period rejection. A bot workflow
test verifies that its historical-message draft retains later registrants.
