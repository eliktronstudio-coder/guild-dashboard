begin;

-- These identity checks depend on the current statement, never on a scanned row.
-- Scalar subqueries become InitPlans, avoiding repeated nested session/profile
-- lookups for every membership and role. Nothing is cached across statements.
create or replace function private.session_user_id() returns uuid language sql stable security definer set search_path='' as $$
 select u.id from auth.users u join auth.sessions s on s.user_id=u.id
 where u.id=(select auth.uid()) and s.id::text=(select auth.jwt()->>'session_id')
 and (u.email_confirmed_at is not null or exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='custom:telegram'))
 and not exists(select 1 from public.revoked_sessions r where r.session_id=s.id)
$$;
create or replace function private.viewer_id() returns uuid language sql stable security definer set search_path='' as $$
 select p.id from public.profiles p where p.id=(select case
 when auth.jwt()->>'role'='service_role' and nullif(current_setting('xd.discord_actor',true),'') is not null
 then nullif(current_setting('xd.discord_actor',true),'')::uuid
 else private.session_user_id() end) and not p.blocked
$$;
create or replace function private.is_member(guild uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships m where m.guild_id=guild and m.user_id=(select private.viewer_id()) and m.status='active')
$$;
create or replace function public.has_permission(guild uuid, permission text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships m join public.membership_roles mr on mr.membership_id=m.id and mr.guild_id=m.guild_id
 join public.roles assigned on assigned.id=mr.role_id and assigned.guild_id=m.guild_id
 join public.roles effective on effective.guild_id=m.guild_id and effective.code=case when assigned.code='guild_master' then 'admin' else assigned.code end
 join public.role_permissions rp on rp.role_id=effective.id
 where m.guild_id=$1 and m.user_id=(select private.viewer_id()) and m.status='active' and rp.permission=$2)
$$;

alter policy profile_read on public.profiles using(id=(select private.session_user_id()) or exists(select 1 from public.memberships m where m.user_id=profiles.id and public.has_permission(m.guild_id,'members.manage')));
alter policy member_read on public.memberships using(user_id=(select private.viewer_id()) or public.has_permission(guild_id,'members.read'));

commit;
