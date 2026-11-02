begin;
insert into public.permissions(key) values ('catalog.manage'),('members.coefficient');
insert into public.role_permissions(role_id,permission)
select id,p from public.roles cross join unnest(array['catalog.manage','members.coefficient']) p where code in ('owner','admin');
alter table public.memberships add column payout_weight integer not null default 100 check(payout_weight between 20 and 125), add column weight_version integer not null default 1;
create table public.guild_catalog (
 id uuid primary key, guild_id uuid not null references public.guilds(id),
 kind text not null check(kind in ('loot','boss')), name text not null check(char_length(btrim(name)) between 1 and 120),
 photo text not null default '' check(length(photo)<=700000 and (photo='' or photo ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$')),
 price_units bigint not null default 0 check(price_units between 0 and 100000000000000),
 weight integer not null default 100 check(weight between 1 and 100000),
 archived boolean not null default false, version integer not null default 1,
 unique(guild_id,id)
);
create unique index guild_catalog_name on public.guild_catalog(guild_id,kind,lower(btrim(name))) where not archived;
alter table public.guild_catalog enable row level security;
create policy catalog_read on public.guild_catalog for select to authenticated using(public.has_permission(guild_id,'catalog.manage') or public.has_permission(guild_id,'events.manage') or public.has_permission(guild_id,'treasury.manage'));
revoke all on public.guild_catalog from public,anon,authenticated;
grant select on public.guild_catalog to authenticated;
alter table public.events add column boss_id uuid, add column boss_name text, add column boss_weight integer check(boss_weight between 1 and 100000), add foreign key(guild_id,boss_id) references public.guild_catalog(guild_id,id);
create function public.save_catalog(p_id uuid,p_kind text,p_version integer,p_name text,p_photo text,p_price bigint,p_weight integer,p_archived boolean) returns void language plpgsql security definer set search_path='' as $$
declare g uuid; old public.guild_catalog;
begin
 select guild_id into g from public.memberships where user_id=private.viewer_id() and status='active' limit 1;
 perform private.lock_finance(g,'catalog.manage');
 select * into old from public.guild_catalog where id=p_id;
 if old.id is not null and (old.guild_id<>g or old.kind<>p_kind) then raise exception 'FORBIDDEN'; end if;
 if p_version is distinct from coalesce(old.version,0) then raise exception 'STALE_VERSION'; end if;
 insert into public.guild_catalog(id,guild_id,kind,name,photo,price_units,weight,archived)
 values(p_id,g,p_kind,btrim(p_name),coalesce(p_photo,old.photo,''),p_price,p_weight,p_archived)
 on conflict(id) do update set name=excluded.name,photo=excluded.photo,price_units=excluded.price_units,weight=excluded.weight,archived=excluded.archived,version=public.guild_catalog.version+1;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'catalog.saved',p_id,jsonb_build_object('name',p_name,'kind',p_kind,'price_units',p_price::text,'weight',p_weight,'archived',p_archived));
end $$;
create function public.set_member_weight(p_id uuid,p_version integer,p_weight integer) returns void language plpgsql security definer set search_path='' as $$
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
create function public.set_event_boss(p_id uuid,p_version integer,p_boss uuid) returns void language plpgsql security definer set search_path='' as $$
declare e public.events;b public.guild_catalog;
begin
 select * into e from public.events where id=p_id;
 perform private.lock_finance(e.guild_id,'events.manage');
 select * into e from public.events where id=p_id for update;
 if e.version is distinct from p_version then raise exception 'STALE_VERSION'; end if;
 if e.status='cancelled' or exists(select 1 from public.treasury_loot l join public.treasury_sales s on s.loot_id=l.id join public.treasury_allocations a on a.sale_id=s.id where l.event_id=e.id and a.voided_at is null) then raise exception 'EVENT_LOCKED'; end if;
 if p_boss is not null then
 select * into b from public.guild_catalog where id=p_boss and guild_id=e.guild_id and kind='boss' and not archived;
 if b.id is null then raise exception 'INVALID_BOSS'; end if;
 end if;
 update public.events set boss_id=b.id,boss_name=b.name,boss_weight=b.weight,version=version+1 where id=e.id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(e.guild_id,private.viewer_id(),'event.boss',e.id,jsonb_build_object('boss',b.name,'weight',b.weight));
end $$;
revoke all on function public.save_catalog(uuid,text,integer,text,text,bigint,integer,boolean),public.set_member_weight(uuid,integer,integer),public.set_event_boss(uuid,integer,uuid) from public,anon;
grant execute on function public.save_catalog(uuid,text,integer,text,text,bigint,integer,boolean),public.set_member_weight(uuid,integer,integer),public.set_event_boss(uuid,integer,uuid) to authenticated;
create or replace view public.member_directory with (security_invoker=true) as
 select m.id,m.guild_id,m.nickname,m.status,m.joined_at,m.about,m.avatar_style,
  c.name as main_character,c.character_class,c.specialization,c.game_server,
  coalesce((select array_agg(r.code order by r.code) from public.membership_roles mr join public.roles r on r.id=mr.role_id where mr.membership_id=m.id),'{}'::text[]) as role_codes,
  coalesce((select array_agg(r.name order by r.code) from public.membership_roles mr join public.roles r on r.id=mr.role_id where mr.membership_id=m.id),'{}'::text[]) as role_names, m.payout_weight,m.weight_version
 from public.memberships m left join public.characters c on c.membership_id=m.id and c.guild_id=m.guild_id and c.is_main and c.archived_at is null;

commit;
