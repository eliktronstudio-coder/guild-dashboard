-- Independent of optional migrations 017/018; safe on the deployed 001–016 schema.
begin;
insert into public.permissions(key) values ('drops.manage') on conflict do nothing;
insert into public.role_permissions(role_id,permission)
select id,'drops.manage' from public.roles where code in ('owner','admin') on conflict do nothing;
create table if not exists public.guild_drop_registry (
 id uuid primary key,
 guild_id uuid not null references public.guilds(id),
 name text not null check(char_length(btrim(name)) between 1 and 120),
 photo text not null default '' check(length(photo)<=100000 and (photo='' or photo ~ '^data:image/png;base64,[A-Za-z0-9+/=]+$')),
 price_units bigint not null check(price_units between 0 and 100000000000000),
 version integer not null default 1 check(version>0)
);
create unique index if not exists guild_drop_registry_name on public.guild_drop_registry(guild_id,lower(btrim(name)));
alter table public.guild_drop_registry enable row level security;
drop policy if exists drop_registry_read on public.guild_drop_registry;
create policy drop_registry_read on public.guild_drop_registry for select to authenticated using(public.has_permission(guild_id,'drops.manage'));
revoke all on public.guild_drop_registry from public,anon,authenticated;
grant select on public.guild_drop_registry to authenticated;
create or replace function public.save_drop_registry(p_guild uuid,p_id uuid,p_version integer,p_name text,p_photo text,p_price bigint)
returns void language plpgsql security definer set search_path='' as $$
declare old public.guild_drop_registry;
begin
 if not public.has_permission(p_guild,'drops.manage') then raise exception 'FORBIDDEN'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('drop-registry:'||p_id::text,0));
 select * into old from public.guild_drop_registry where id=p_id for update;
 if old.id is not null and old.guild_id<>p_guild then raise exception 'FORBIDDEN'; end if;
 if p_version is distinct from coalesce(old.version,0) then raise exception 'STALE_VERSION'; end if;
 insert into public.guild_drop_registry(id,guild_id,name,photo,price_units)
 values(p_id,p_guild,btrim(p_name),coalesce(p_photo,old.photo,''),p_price)
 on conflict(id) do update set name=excluded.name,photo=excluded.photo,price_units=excluded.price_units,version=public.guild_drop_registry.version+1;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail)
 values(p_guild,private.viewer_id(),'drop_registry.saved',p_id,jsonb_build_object('name',btrim(p_name),'price_units',p_price::text,'previous_price_units',old.price_units::text));
end $$;
create or replace function public.delete_drop_registry(p_guild uuid,p_id uuid,p_version integer)
returns void language plpgsql security definer set search_path='' as $$
declare old public.guild_drop_registry;
begin
 if not public.has_permission(p_guild,'drops.manage') then raise exception 'FORBIDDEN'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('drop-registry:'||p_id::text,0));
 select * into old from public.guild_drop_registry where id=p_id for update;
 if old.id is null or old.guild_id<>p_guild then raise exception 'FORBIDDEN'; end if;
 if p_version is distinct from old.version then raise exception 'STALE_VERSION'; end if;
 delete from public.guild_drop_registry where id=p_id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail)
 values(p_guild,private.viewer_id(),'drop_registry.deleted',p_id,jsonb_build_object('name',old.name,'price_units',old.price_units::text));
end $$;
revoke all on function public.save_drop_registry(uuid,uuid,integer,text,text,bigint),public.delete_drop_registry(uuid,uuid,integer) from public,anon;
grant execute on function public.save_drop_registry(uuid,uuid,integer,text,text,bigint),public.delete_drop_registry(uuid,uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
