begin;
-- Login and enrollment intent are private; passwords remain exclusively in Supabase Auth.
create table private.email_registrations (
 user_id uuid primary key references public.profiles(id),
 login text unique not null check(login ~ '^[a-z][a-z0-9_.-]{2,31}$'),
 nickname text not null check(private.valid_nickname(nickname)),
 rules_version text not null default '2026-11-09', privacy_version text not null default '2026-11-09',
 consent_at timestamptz not null default now(), completed_at timestamptz
);
revoke all on private.email_registrations from public,anon,authenticated;
create function private.capture_email_registration() returns trigger language plpgsql security definer set search_path='' as $$
declare meta jsonb:=new.raw_user_meta_data; clean text;
begin
 if meta->>'registration_flow' is distinct from 'open_email_v1' then return new; end if;
 clean:=private.clean_nickname(meta->>'game_nickname');
 if not private.valid_nickname(clean) or coalesce(meta->>'login','') !~ '^[a-z][a-z0-9_.-]{2,31}$' then raise exception 'INVALID_REGISTRATION'; end if;
 if meta->>'rules_accepted' is distinct from 'true' or meta->>'privacy_accepted' is distinct from 'true' then raise exception 'CONSENT_REQUIRED'; end if;
 insert into public.profiles(id) values(new.id) on conflict do nothing;
 insert into private.email_registrations(user_id,login,nickname) values(new.id,meta->>'login',clean);
 return new;
end $$;
create trigger xd_registration_capture after insert on auth.users for each row execute function private.capture_email_registration();
revoke all on function private.capture_email_registration() from public,anon,authenticated;

create function public.complete_open_registration(p_login text default null,p_nickname text default null,p_rules boolean default false,p_privacy boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.viewer_id(); g uuid:='00000000-0000-4000-8000-000000000001'; r private.email_registrations; m public.memberships; clean text; result uuid;
begin
 if actor is null then raise exception 'AUTH_REQUIRED'; end if;
 perform 1 from public.guilds where id=g for update;
 select * into m from public.memberships where guild_id=g and user_id=actor for update;
 if m.id is not null then
  if m.status<>'active' then raise exception 'MEMBERSHIP_INACTIVE'; end if;
  return m.id;
 end if;
 select * into r from private.email_registrations where user_id=actor for update;
 if r.user_id is null then
  if p_rules is distinct from true or p_privacy is distinct from true then raise exception 'CONSENT_REQUIRED'; end if;
  clean:=private.clean_nickname(p_nickname);
  if not private.valid_nickname(clean) then raise exception 'INVALID_NICKNAME'; end if;
  if coalesce(p_login,'') !~ '^[a-z][a-z0-9_.-]{2,31}$' then raise exception 'INVALID_LOGIN'; end if;
  insert into private.email_registrations(user_id,login,nickname) values(actor,p_login,clean) returning * into r;
 end if;
 if p_login is not null and r.user_id is not null then
  if p_rules is distinct from true or p_privacy is distinct from true then raise exception 'CONSENT_REQUIRED'; end if;
  clean:=private.clean_nickname(p_nickname);
  if not private.valid_nickname(clean) then raise exception 'INVALID_NICKNAME'; end if;
  if p_login !~ '^[a-z][a-z0-9_.-]{2,31}$' then raise exception 'INVALID_LOGIN'; end if;
  update private.email_registrations set login=p_login,nickname=clean,consent_at=now() where user_id=actor returning * into r;
 end if;
 if exists(select 1 from public.memberships where guild_id=g and status='active' and nickname_key=private.nickname_key(r.nickname)) then raise exception 'NICKNAME_UNAVAILABLE'; end if;
 insert into public.memberships(guild_id,user_id,nickname) values(g,actor,r.nickname) returning id into result;
 insert into public.membership_roles(guild_id,membership_id,role_id) select g,result,id from public.roles where guild_id=g and code='member';
 update private.email_registrations set completed_at=now() where user_id=actor;
 -- Close an existing pending application without pretending it was reviewed by an administrator.
 update public.applications set status='approved',reviewed_at=now(),reviewed_by=actor,reason='Свободная регистрация' where guild_id=g and user_id=actor and status='pending';
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,actor,'member.self_registered',result,jsonb_build_object('rules_version',r.rules_version,'privacy_version',r.privacy_version,'consent_at',r.consent_at));
 return result;
end $$;
revoke all on function public.complete_open_registration(text,text,boolean,boolean) from public,anon;
grant execute on function public.complete_open_registration(text,text,boolean,boolean) to authenticated;

-- Only the trusted server resolves logins; never expose the associated email to browsers.
create function public.registration_login_email(p_login text) returns text language sql stable security definer set search_path='' as $$
 select u.email from private.email_registrations r join auth.users u on u.id=r.user_id join public.profiles p on p.id=r.user_id where r.login=p_login and not p.blocked
$$;
revoke all on function public.registration_login_email(text) from public,anon,authenticated;
grant execute on function public.registration_login_email(text) to service_role;

create table private.auth_attempts (key text not null check(key ~ '^[a-f0-9]{64}$'), attempted_at timestamptz not null default clock_timestamp());
create index xd_auth_attempts_key_time on private.auth_attempts(key,attempted_at);
revoke all on private.auth_attempts from public,anon,authenticated;
create function public.claim_auth_attempt(p_key text,p_limit integer,p_seconds integer) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_key !~ '^[a-f0-9]{64}$' or p_limit not between 1 and 100 or p_seconds not between 60 and 86400 then raise exception 'INVALID_INPUT'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_key,0));
 delete from private.auth_attempts where attempted_at<clock_timestamp()-interval '1 day';
 if (select count(*) from private.auth_attempts where key=p_key and attempted_at>clock_timestamp()-make_interval(secs=>p_seconds))>=p_limit then return false; end if;
 insert into private.auth_attempts(key) values(p_key); return true;
end $$;
revoke all on function public.claim_auth_attempt(text,integer,integer) from public,anon,authenticated;
grant execute on function public.claim_auth_attempt(text,integer,integer) to service_role;
notify pgrst,'reload schema';
commit;
