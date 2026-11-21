# Access query performance and recovery

Migration 038 changes statement plans, not authorization rules. Identity functions
use scalar subqueries so PostgreSQL evaluates the session/profile lookup once per
statement instead of once per scanned row. They remain STABLE SECURITY DEFINER
functions with an empty search path and retain their existing grants. Profile and
membership policies use the same predicates with statement-scoped identity plans.

Session ownership, confirmed email or Telegram identity, session revocation,
profile blocking, active membership and effective role permissions are preserved.
The service-role-only Discord actor branch from migration 023 is retained. There
is no cross-request or cross-user cache. Financial records and inventory are not
updated by the migration.

Within one React server request, duplicate permission keys share their in-flight
promise. Independent menu checks run in parallel. Sidebar routes are loaded on
navigation instead of prefetching them in the background.

Profile/membership/permission query failures now reach the page error boundary
instead of redirecting to initial guild setup. Logs contain the failing stage and
database error code, without account identifiers, tokens or query data. The retry
button refreshes the server response and resets the boundary. Existing
`/setup?problem=database` links offer a return to the dashboard.

Validation: native SQL tests exercise identity changes, blocks, revocation,
session/user mismatch and permission removal on an existing connection. Existing
role, Discord delegation, inventory, payroll and archive tests also cover 038.
`apps/web/scripts/check-access-recovery.py` runs the production Next build against
local fixtures: one permission request per key, a simulated 503, preserved session
and route, and successful retry after recovery. It never uses live user accounts.
