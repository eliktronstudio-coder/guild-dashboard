begin;
insert into public.permissions(key) values ('members.coefficient') on conflict do nothing;
insert into public.role_permissions(role_id,permission) select id,'members.coefficient' from public.roles where code in ('owner','admin') on conflict do nothing;
alter table public.memberships add column if not exists payout_weight integer not null default 100 check(payout_weight between 20 and 125), add column if not exists weight_version integer not null default 1;
create or replace function public.set_member_weight(p_id uuid,p_version integer,p_weight integer) returns void language plpgsql security definer set search_path='' as $$
declare m public.memberships;
begin
 select * into m from public.memberships where id=p_id;
 perform private.lock_finance(m.guild_id,'members.coefficient');
 select * into m from public.memberships where id=p_id for update;
 if m.weight_version is distinct from p_version then raise exception 'STALE_VERSION'; end if;
 if p_weight is null or p_weight not between 20 and 125 then raise exception 'INVALID_WEIGHT'; end if;
 update public.memberships set payout_weight=p_weight,weight_version=weight_version+1 where id=p_id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(m.guild_id,private.viewer_id(),'member.coefficient',p_id,jsonb_build_object('nickname',m.nickname,'before',m.payout_weight,'after',p_weight));
end $$;

revoke all on function public.set_member_weight(uuid,integer,integer) from public,anon;
grant execute on function public.set_member_weight(uuid,integer,integer) to authenticated;
create or replace view public.member_directory with (security_invoker=true) as
 select m.id,m.guild_id,m.nickname,m.status,m.joined_at,m.about,m.avatar_style,
  c.name as main_character,c.character_class,c.specialization,c.game_server,
  coalesce((select array_agg(r.code order by r.code) from public.membership_roles mr join public.roles r on r.id=mr.role_id where mr.membership_id=m.id),'{}'::text[]) as role_codes,
  coalesce((select array_agg(r.name order by r.code) from public.membership_roles mr join public.roles r on r.id=mr.role_id where mr.membership_id=m.id),'{}'::text[]) as role_names, m.payout_weight,m.weight_version
 from public.memberships m left join public.characters c on c.membership_id=m.id and c.guild_id=m.guild_id and c.is_main and c.archived_at is null;

commit;
