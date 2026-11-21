-- Run ONCE in the Supabase SQL Editor as postgres, after the owner has signed in.
-- Replace the UUID with the exact account UUID from Authentication → Users.
-- Check that this is your account, not a matching game nickname or email alone.
-- The function refuses a second bootstrap. There is no public setup endpoint.
select private.bootstrap_owner(
  'REPLACE_WITH_VERIFIED_AUTH_USER_UUID'::uuid,
  'ВашНик'
);
