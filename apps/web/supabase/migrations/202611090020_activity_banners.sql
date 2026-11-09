-- Activity banner registry; independent of optional financial migrations 017/018.
begin;
insert into public.permissions(key) values ('activity_banners.manage') on conflict do nothing;
insert into public.role_permissions(role_id,permission)
select id,'activity_banners.manage' from public.roles where code in ('owner','admin') on conflict do nothing;
create table if not exists public.guild_activity_banners (
 id uuid primary key,
 guild_id uuid not null references public.guilds(id),
 name text not null check(char_length(btrim(name)) between 3 and 120),
 photo text not null default '' check(length(photo)<=500000 and (photo='' or photo ~ '^data:image/png;base64,[A-Za-z0-9+/=]+$')),
 weight integer not null check(weight between 1 and 100000),
 version integer not null default 1 check(version>0)
);
create unique index if not exists guild_activity_banners_name on public.guild_activity_banners(guild_id,lower(btrim(name)));
alter table public.guild_activity_banners enable row level security;
drop policy if exists activity_banner_read on public.guild_activity_banners;
create policy activity_banner_read on public.guild_activity_banners for select to authenticated using(exists(select 1 from public.memberships m where m.guild_id=guild_activity_banners.guild_id and m.user_id=private.viewer_id() and m.status='active'));
revoke all on public.guild_activity_banners from public,anon,authenticated;
grant select on public.guild_activity_banners to authenticated;
create or replace function public.save_activity_banner(p_guild uuid,p_id uuid,p_version integer,p_name text,p_photo text,p_weight integer)
returns void language plpgsql security definer set search_path='' as $$
declare old public.guild_activity_banners;
begin
 if not public.has_permission(p_guild,'activity_banners.manage') then raise exception 'FORBIDDEN'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('activity-banner:'||p_id::text,0));
 select * into old from public.guild_activity_banners where id=p_id for update;
 if old.id is not null and old.guild_id<>p_guild then raise exception 'FORBIDDEN'; end if;
 if p_version is distinct from coalesce(old.version,0) then raise exception 'STALE_VERSION'; end if;
 insert into public.guild_activity_banners(id,guild_id,name,photo,weight)
 values(p_id,p_guild,btrim(p_name),coalesce(p_photo,old.photo,''),p_weight)
 on conflict(id) do update set name=excluded.name,photo=excluded.photo,weight=excluded.weight,version=public.guild_activity_banners.version+1;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail)
 values(p_guild,private.viewer_id(),'activity_banner.saved',p_id,jsonb_build_object('name',btrim(p_name),'weight',p_weight::text,'previous_weight',old.weight::text));
end $$;
create or replace function public.delete_activity_banner(p_guild uuid,p_id uuid,p_version integer)
returns void language plpgsql security definer set search_path='' as $$
declare old public.guild_activity_banners;
begin
 if not public.has_permission(p_guild,'activity_banners.manage') then raise exception 'FORBIDDEN'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('activity-banner:'||p_id::text,0));
 select * into old from public.guild_activity_banners where id=p_id for update;
 if old.id is null or old.guild_id<>p_guild then raise exception 'FORBIDDEN'; end if;
 if p_version is distinct from old.version then raise exception 'STALE_VERSION'; end if;
 delete from public.guild_activity_banners where id=p_id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail)
 values(p_guild,private.viewer_id(),'activity_banner.deleted',p_id,jsonb_build_object('name',old.name,'weight',old.weight::text));
end $$;
revoke all on function public.save_activity_banner(uuid,uuid,integer,text,text,integer),public.delete_activity_banner(uuid,uuid,integer) from public,anon;
grant execute on function public.save_activity_banner(uuid,uuid,integer,text,text,integer),public.delete_activity_banner(uuid,uuid,integer) to authenticated;
alter table public.events add column if not exists activity_banner_id uuid,
 add column if not exists activity_banner_name text,
 add column if not exists activity_banner_photo text,
 add column if not exists activity_weight integer check(activity_weight between 1 and 100000);
create or replace function public.create_banner_event(p_banner uuid,p_request_id uuid,p_title text,p_kind text,p_starts_at timestamptz,p_description text,p_counts boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare g uuid;b public.guild_activity_banners;e public.events;created uuid;
begin
 select id into g from public.guilds where slug='xd' for update;
 if not public.has_permission(g,'events.manage') then raise exception 'FORBIDDEN'; end if;
 select * into e from public.events where id=p_request_id;
 if e.id is not null then
  if e.guild_id<>g or e.activity_banner_id is distinct from p_banner then raise exception 'REQUEST_CONFLICT'; end if;
  return public.create_guild_event(p_request_id,p_title,p_kind,p_starts_at,p_description,p_counts);
 end if;
 select * into b from public.guild_activity_banners where id=p_banner and guild_id=g for share;
 if b.id is null then raise exception 'INVALID_BANNER'; end if;
 created:=public.create_guild_event(p_request_id,p_title,p_kind,p_starts_at,p_description,p_counts);
 update public.events set activity_banner_id=b.id,activity_banner_name=b.name,activity_banner_photo=b.photo,activity_weight=b.weight where id=created;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'event.banner_selected',created,jsonb_build_object('banner_id',b.id,'name',b.name,'weight',b.weight));
 return created;
end $$;
revoke all on function public.create_banner_event(uuid,uuid,text,text,timestamptz,text,boolean) from public,anon;
grant execute on function public.create_banner_event(uuid,uuid,text,text,timestamptz,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
