begin;
-- Storage position is independent of Prime/Mini RB accounting category.
alter table public.treasury_loot add column xd_quantity integer not null default 0 check(xd_quantity between 0 and quantity_remaining);
alter table public.treasury_loot add column xd_received_at timestamptz;
update public.treasury_loot l set xd_quantity=case when source='mini_rb' then quantity_remaining else least(quantity_remaining,private.auction_reserved(id)::integer) end;
update public.treasury_loot set xd_received_at=created_at where xd_quantity>0;
create table public.inventory_transfers(
 id uuid primary key,guild_id uuid not null,loot_id uuid not null,quantity integer not null check(quantity between 1 and 1000000),
 created_at timestamptz not null default now(),created_by uuid not null references public.profiles(id),
 foreign key(guild_id,loot_id) references public.treasury_loot(guild_id,id)
);
alter table public.inventory_transfers enable row level security;
create policy transfers_read on public.inventory_transfers for select to authenticated using(public.has_permission(guild_id,'treasury.read'));
revoke all on public.inventory_transfers from public,anon,authenticated;
grant select on public.inventory_transfers to authenticated;
alter table public.inventory_disposals add column warehouse text not null default 'general' check(warehouse in ('general','xd'));
create function public.transfer_inventory_to_xd(p_request uuid,p_loot uuid,p_version integer,p_quantity integer) returns uuid language plpgsql security definer set search_path='' as $$
declare l public.treasury_loot;t public.inventory_transfers;
begin
 select * into l from public.treasury_loot where id=p_loot;perform private.lock_treasury(l.guild_id);
 select * into l from public.treasury_loot where id=p_loot for update;
 if p_request is null or p_quantity is null or p_quantity not between 1 and 1000000 then raise exception 'INVALID_QUANTITY'; end if;
 select * into t from public.inventory_transfers where id=p_request;
 if t.id is not null then
  if t.guild_id=l.guild_id and t.loot_id=l.id and t.quantity=p_quantity then return t.id; end if;
  raise exception 'REQUEST_CONFLICT';
 end if;
 if l.version is distinct from p_version then raise exception 'STALE_VERSION'; end if;
 if p_quantity>l.quantity_remaining-l.xd_quantity then raise exception 'INSUFFICIENT_STOCK'; end if;
 insert into public.inventory_transfers(id,guild_id,loot_id,quantity,created_by) values(p_request,l.guild_id,l.id,p_quantity,private.viewer_id());
 update public.treasury_loot set xd_quantity=xd_quantity+p_quantity,xd_received_at=now(),version=version+1 where id=l.id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(l.guild_id,private.viewer_id(),'inventory.transferred_to_xd',p_request,jsonb_build_object('loot_id',l.id,'quantity',p_quantity,'source',l.source,'archived_period',l.archived_period));
 return p_request;
end $$;
create function private.guard_inventory_position() returns trigger language plpgsql security definer set search_path='' as $$
declare l public.treasury_loot;available integer;
begin
 if TG_TABLE_NAME='treasury_loot' then
  if new.xd_quantity<private.auction_reserved(new.id) then raise exception 'STOCK_RESERVED'; end if;
  return new;
 end if;
 select * into l from public.treasury_loot where id=new.loot_id;
 perform 1 from public.guilds where id=l.guild_id for update;
 select * into l from public.treasury_loot where id=new.loot_id for update;
 available:=l.xd_quantity-private.auction_reserved(l.id);
 if new.quantity>available then raise exception 'USE_XD_INVENTORY'; end if;
 if TG_TABLE_NAME='treasury_sales' then update public.treasury_loot set xd_quantity=xd_quantity-new.quantity where id=l.id; end if;
 return new;
end $$;
create trigger position_sale before insert on public.treasury_sales for each row execute function private.guard_inventory_position();
create trigger position_auction before insert on public.inventory_auctions for each row execute function private.guard_inventory_position();
create trigger position_stock before update on public.treasury_loot for each row execute function private.guard_inventory_position();
revoke all on function private.guard_inventory_position() from public,anon,authenticated;
alter function public.discard_inventory_stock(uuid,uuid,integer,integer,text) rename to discard_inventory_stock_before_positions;
revoke all on function public.discard_inventory_stock_before_positions(uuid,uuid,integer,integer,text) from public,anon,authenticated;
create function public.discard_inventory_position(p_request uuid,p_loot uuid,p_version integer,p_quantity integer,p_warehouse text,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare l public.treasury_loot;d public.inventory_disposals;result uuid;available integer;
begin
 select * into l from public.treasury_loot where id=p_loot;perform private.lock_treasury(l.guild_id);
 select * into l from public.treasury_loot where id=p_loot for update;
 if p_warehouse is null or p_warehouse not in ('general','xd') or p_quantity is null or p_quantity not between 1 and 1000000 then raise exception 'INVALID_INPUT'; end if;
 select * into d from public.inventory_disposals where id=p_request;
 if d.id is not null then
  if d.guild_id=l.guild_id and d.loot_id=l.id and d.quantity=p_quantity and d.warehouse=p_warehouse and d.reason=btrim(p_reason) then return d.id; end if;
  raise exception 'REQUEST_CONFLICT';
 end if;
 if l.version is distinct from p_version then raise exception 'STALE_VERSION'; end if;
 available:=case when p_warehouse='general' then l.quantity_remaining-l.xd_quantity else l.xd_quantity-private.auction_reserved(l.id) end;
 if p_quantity>available then raise exception 'INSUFFICIENT_STOCK'; end if;
 if p_warehouse='xd' then update public.treasury_loot set xd_quantity=xd_quantity-p_quantity where id=l.id; end if;
 result:=public.discard_inventory_stock_before_positions(p_request,p_loot,p_version,p_quantity,p_reason);
 update public.inventory_disposals set warehouse=p_warehouse where id=result;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(l.guild_id,private.viewer_id(),'inventory.position_discarded',result,jsonb_build_object('loot_id',l.id,'quantity',p_quantity,'warehouse',p_warehouse));
 return result;
end $$;
create function public.discard_inventory_stock(p_request uuid,p_loot uuid,p_version integer,p_quantity integer,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare l public.treasury_loot;d public.inventory_disposals;
begin
 select * into l from public.treasury_loot where id=p_loot;perform private.lock_treasury(l.guild_id);
 select * into l from public.treasury_loot where id=p_loot for update;
 select * into d from public.inventory_disposals where id=p_request;
 return public.discard_inventory_position(p_request,p_loot,p_version,p_quantity,coalesce(d.warehouse,case when l.quantity_remaining-l.xd_quantity>=p_quantity then 'general' else 'xd' end),p_reason);
end $$;
-- A sale reversal restores physical units to general storage; a new transfer
-- explicitly readies them for sale again, without changing financial history.
create or replace view public.treasury_inventory with(security_invoker=true) as
select l.id,l.guild_id,l.event_id,l.source,l.name,l.category,l.quantity_total,l.quantity_remaining,
 l.estimated_unit_units::text estimated_unit_units,(l.quantity_remaining*l.estimated_unit_units::numeric)::text estimated_total_units,
 l.note,l.version,l.created_at,e.title event_title,e.starts_at event_starts_at,l.archived_period,l.catalog_id,
 coalesce(a.reserved,0)::integer auction_quantity,(l.quantity_remaining-coalesce(a.reserved,0))::integer available_quantity,
 l.xd_quantity,(l.quantity_remaining-l.xd_quantity)::integer general_quantity,l.xd_received_at
from public.treasury_loot l join public.events e on e.id=l.event_id and e.guild_id=l.guild_id
left join lateral(select sum(quantity_remaining) reserved from public.inventory_auctions where loot_id=l.id and status='active') a on true;
revoke all on function public.transfer_inventory_to_xd(uuid,uuid,integer,integer),public.discard_inventory_position(uuid,uuid,integer,integer,text,text),public.discard_inventory_stock(uuid,uuid,integer,integer,text) from public,anon;
grant execute on function public.transfer_inventory_to_xd(uuid,uuid,integer,integer),public.discard_inventory_position(uuid,uuid,integer,integer,text,text),public.discard_inventory_stock(uuid,uuid,integer,integer,text) to authenticated;
commit;
