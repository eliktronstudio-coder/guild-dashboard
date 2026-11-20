# Email access for existing Telegram accounts

An authenticated Telegram-only user opens `/account/email`, enters their own email and a matching password (12–128 characters), and confirms adding a login method to the current account. A notice in the shared site layout points Telegram-only users to this page. After setup, `/login` accepts the new email/password and Telegram remains linked.

The action verifies the current session and profile through `getAccess`, then fetches the same Auth user by that server-derived ID. It calls `auth.admin.updateUserById` on that ID only; it never creates a user, searches for a player by nickname, merges identities by an entered email, or invokes membership enrollment. Profile, membership, roles, attendance, drops, payroll and archive IDs remain unchanged. Existing email identities cannot be replaced through this action; occupied addresses are rejected by Auth.

The existing no-SMTP registration policy applies: `email_confirm: true` enables password login without a verification message, while metadata explicitly retains `email_ownership_verified: false`. This does not prove ownership of the mailbox. Existing user metadata is preserved, and no password is stored in application metadata or tables. The UI states that verification and recovery email delivery is unavailable.

Supabase Admin password changes revoke old sessions. After updating credentials, the action immediately signs in using the new password and verifies that Auth returned the original user ID. If establishing that session fails, it redirects to the login page with a notice that the email is already connected; it does not repeat account creation or roll back unrelated site data. Other devices may require a new login.

The action requires same-origin POST and uses the existing persistent HMAC attempt gate: five email-link attempts per IP/hour, three per email/hour and five per account/hour. Anonymous, revoked and blocked sessions cannot invoke the privileged update through the site.

This is self-service linking from an existing session, not an anonymous recovery endpoint. Someone who has already signed out and cannot use either login method needs administrator-assisted identity verification; a nickname alone is never sufficient to claim an account. Registering again creates a separate account and is not a recovery procedure.

No database migration or SMTP configuration is required. Validation: `tests/email-login.test.ts`; `npm run typecheck`; `npm run build`; `python3 scripts/check-email-login.py` uses the actual production Next server with isolated Auth/DB fixtures, checks duplicate/rate rejection, original-ID preservation, automatic login after session revocation, stale-form protection and subsequent password login without touching real accounts.
