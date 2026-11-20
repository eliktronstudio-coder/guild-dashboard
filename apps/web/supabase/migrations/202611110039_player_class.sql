begin;
-- Existing memberships deliberately remain unselected until the player chooses.
alter table public.memberships
 add column player_class text check(player_class in ('Лучник','Маг','Милик','Танк')),
 add column class_selected_at timestamptz,
 add constraint player_class_selection check((player_class is null)=(class_selected_at is null));
alter table private.email_registrations add column player_class text check(player_class in ('Лучник','Маг','Милик','Танк'));

create or replace function private.capture_email_registration() returns trigger language plpgsql security definer set search_path='' as $$
declare meta jsonb:=new.raw_user_meta_data; clean text; chosen text:=meta->>'game_class';
begin
 if meta->>'registration_flow' is distinct from 'open_email_v1' then return new; end if;
 clean:=private.clean_nickname(meta->>'game_nickname');
 if not private.valid_nickname(clean) or coalesce(meta->>'login','') !~ '^[a-z][a-z0-9_.-]{2,31}$' then raise exception 'INVALID_REGISTRATION'; end if;
 if chosen is null or chosen not in ('Лучник','Маг','Милик','Танк') then raise exception 'CLASS_REQUIRED';end if;
 if meta->>'rules_accepted' is distinct from 'true' or meta->>'privacy_accepted' is distinct from 'true' then raise exception 'CONSENT_REQUIRED'; end if;
 insert into public.profiles(id) values(new.id) on conflict do nothing;
 insert into private.email_registrations(user_id,login,nickname,player_class) values(new.id,meta->>'login',clean,chosen);
 return new;
end $$;

-- Keep enrollment consent, uniqueness, audit and role assignment in the proven
-- implementation, but expose only the wrapper that requires a valid class.
alter function public.complete_open_registration(text,text,boolean,boolean) rename to complete_open_registration_before_class;
revoke all on function public.complete_open_registration_before_class(text,text,boolean,boolean) from public,anon,authenticated,service_role;
create function public.complete_open_registration(p_login text default null,p_nickname text default null,p_rules boolean default false,p_privacy boolean default false,p_class text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.viewer_id();g uuid:='00000000-0000-4000-8000-000000000001'; chosen text; result uuid;
begin
 if actor is null then raise exception 'AUTH_REQUIRED';end if;
 perform 1 from public.guilds where id=g for update;
 -- Existing members choose through the one-time profile prompt, never by an
 -- enrollment retry that could overwrite their saved selection.
 if exists(select 1 from public.memberships where guild_id=g and user_id=actor) then
  return public.complete_open_registration_before_class(p_login,p_nickname,p_rules,p_privacy);
 end if;
 chosen:=coalesce(p_class,(select player_class from private.email_registrations where user_id=actor));
 if chosen is null or chosen not in ('Лучник','Маг','Милик','Танк') then raise exception 'CLASS_REQUIRED';end if;
 result:=public.complete_open_registration_before_class(p_login,p_nickname,p_rules,p_privacy);
 update public.memberships set player_class=chosen,class_selected_at=now() where id=result and user_id=actor and guild_id=g;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,actor,'member.class_selected',result,jsonb_build_object('class',chosen,'source','registration'));
 return result;
end $$;
revoke all on function public.complete_open_registration(text,text,boolean,boolean,text) from public,anon;
grant execute on function public.complete_open_registration(text,text,boolean,boolean,text) to authenticated;

create function public.set_own_player_class(p_class text) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.viewer_id();g uuid:='00000000-0000-4000-8000-000000000001';m public.memberships;
begin
 if actor is null then raise exception 'AUTH_REQUIRED';end if;
 if p_class is null or p_class not in ('Лучник','Маг','Милик','Танк') then raise exception 'INVALID_PLAYER_CLASS';end if;
 perform 1 from public.guilds where id=g for update;
 select * into m from public.memberships where guild_id=g and user_id=actor and status='active' for update;
 if m.id is null then raise exception 'FORBIDDEN';end if;
 if m.class_selected_at is not null then
  if m.player_class=p_class then return;end if;
  raise exception 'CLASS_ALREADY_SELECTED';
 end if;
 update public.memberships set player_class=p_class,class_selected_at=now() where id=m.id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,actor,'member.class_selected',m.id,jsonb_build_object('class',p_class,'source','existing_member'));
end $$;
revoke all on function public.set_own_player_class(text) from public,anon;
grant execute on function public.set_own_player_class(text) to authenticated;

create or replace view public.member_directory with (security_invoker=true) as
 select m.id,m.guild_id,m.nickname,m.status,m.joined_at,m.about,m.avatar_style,
  c.name as main_character,coalesce(m.player_class,c.character_class) as character_class,c.specialization,c.game_server,
  coalesce((select array_agg(r.code order by r.code) from public.membership_roles mr join public.roles r on r.id=mr.role_id where mr.membership_id=m.id),'{}'::text[]) as role_codes,
  coalesce((select array_agg(r.name order by r.code) from public.membership_roles mr join public.roles r on r.id=mr.role_id where mr.membership_id=m.id),'{}'::text[]) as role_names,m.payout_weight,m.weight_version
 from public.memberships m left join public.characters c on c.membership_id=m.id and c.guild_id=m.guild_id and c.is_main and c.archived_at is null;
do $$
declare definition text;needle text:='''character_class'',c.character_class';
begin
 definition:=pg_get_functiondef('public.activity_detail(uuid)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'CLASS_DETAIL_DEFINITION_MISMATCH';end if;
 execute replace(definition,needle,'''character_class'',coalesce(m.player_class,c.character_class)');
end $$;
commit;
