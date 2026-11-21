begin;
create function private.close_owner_application(g uuid,u uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.memberships m join public.membership_roles mr on mr.membership_id=m.id and mr.guild_id=m.guild_id join public.roles r on r.id=mr.role_id and r.guild_id=m.guild_id where m.guild_id=g and m.user_id=u and m.status='active' and r.code='owner') then raise exception 'FORBIDDEN';end if;
 with closed as (
  update public.applications set status='approved',reviewed_by=u,reviewed_at=now(),reason='Первичное назначение владельца'
  where guild_id=g and user_id=u and status='pending' returning id,nickname
 ) insert into public.audit_log(guild_id,actor_id,action,target_id,detail)
 select g,u,'application.approved',id,jsonb_build_object('nickname',nickname,'reason','Первичное назначение владельца','source','owner_bootstrap') from closed;
end $$;
revoke all on function private.close_owner_application(uuid,uuid) from public,anon,authenticated,service_role;
create or replace function private.bootstrap_owner(user_id uuid, nickname text) returns void language plpgsql security definer set search_path='' as $$
declare guild uuid; member uuid;
begin
 select id into guild from public.guilds where slug='xd' for update;
 if exists(select 1 from public.membership_roles mr join public.roles r on r.id=mr.role_id where r.guild_id=guild and r.code='owner') then raise exception 'OWNER_ALREADY_EXISTS'; end if;
 if not exists(select 1 from auth.users u where u.id=$1 and (u.email_confirmed_at is not null or exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='custom:telegram'))) then raise exception 'VERIFIED_USER_REQUIRED'; end if;
 insert into public.memberships(guild_id,user_id,nickname) values(guild,$1,private.clean_nickname($2)) returning id into member;
 insert into public.membership_roles select guild,member,id from public.roles where guild_id=guild and code='owner';
 insert into public.audit_log(guild_id,actor_id,action,target_id) values(guild,$1,'owner.bootstrapped',member);
 perform private.close_owner_application(guild,$1);
end $$;

-- Repair only pending applications belonging to existing active owners.
do $$ declare owner_row record;begin
 for owner_row in select distinct m.guild_id,m.user_id from public.memberships m join public.membership_roles mr on mr.membership_id=m.id and mr.guild_id=m.guild_id join public.roles r on r.id=mr.role_id and r.guild_id=m.guild_id where m.status='active' and r.code='owner'
 loop perform private.close_owner_application(owner_row.guild_id,owner_row.user_id);end loop;
end $$;
commit;
