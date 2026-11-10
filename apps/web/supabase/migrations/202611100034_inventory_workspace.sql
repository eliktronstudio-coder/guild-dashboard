begin;
alter table public.treasury_sales add column buyer_name text not null default '' check(length(buyer_name)<=80),add column sale_channel text not null default 'direct' check(sale_channel in ('direct','auction'));
create table public.inventory_auctions(
 id uuid primary key,guild_id uuid not null,loot_id uuid not null,
 quantity integer not null check(quantity between 1 and 1000000),quantity_remaining integer not null check(quantity_remaining between 0 and quantity),
 unit_price_units bigint not null check(unit_price_units between 1 and 100000000000000),
 status text not null default 'active' check(status in ('active','sold','cancelled')),
 version integer not null default 1,created_at timestamptz not null default now(),created_by uuid not null references public.profiles(id),
 foreign key(guild_id,loot_id) references public.treasury_loot(guild_id,id),unique(guild_id,id),check((status='sold')=(quantity_remaining=0))
);
create index active_inventory_auctions on public.inventory_auctions(loot_id) where status='active';
create table public.inventory_auction_sales(
 sale_id uuid primary key references public.treasury_sales(id),guild_id uuid not null,auction_id uuid not null,
 foreign key(guild_id,auction_id) references public.inventory_auctions(guild_id,id)
);
create table public.inventory_disposals(
 id uuid primary key,guild_id uuid not null,loot_id uuid not null,quantity integer not null check(quantity between 1 and 1000000),
 reason text not null check(length(btrim(reason)) between 3 and 500),created_at timestamptz not null default now(),created_by uuid not null references public.profiles(id),
 foreign key(guild_id,loot_id) references public.treasury_loot(guild_id,id)
);
alter table public.inventory_auctions enable row level security;
alter table public.inventory_auction_sales enable row level security;
alter table public.inventory_disposals enable row level security;
create policy auctions_read on public.inventory_auctions for select to authenticated using(public.has_permission(guild_id,'treasury.read'));
create policy auction_sales_read on public.inventory_auction_sales for select to authenticated using(public.has_permission(guild_id,'treasury.read'));
create policy disposals_read on public.inventory_disposals for select to authenticated using(public.has_permission(guild_id,'treasury.read'));
revoke all on public.inventory_auctions,public.inventory_auction_sales,public.inventory_disposals from public,anon,authenticated;
grant select on public.inventory_auctions,public.inventory_auction_sales,public.inventory_disposals to authenticated;
create function private.auction_reserved(p_loot uuid) returns bigint language sql stable security definer set search_path='' as $$
 select coalesce(sum(quantity_remaining),0)::bigint from public.inventory_auctions where loot_id=p_loot and status='active'
$$;
create function private.guard_auction_stock() returns trigger language plpgsql security definer set search_path='' as $$
declare available bigint;reserved bigint;
begin
 if TG_TABLE_NAME='treasury_sales' then
  reserved:=private.auction_reserved(new.loot_id);
  select quantity_remaining-reserved into available from public.treasury_loot where id=new.loot_id;
  if reserved>0 and new.quantity>available then raise exception 'STOCK_RESERVED'; end if;
 else
  if new.quantity_remaining<private.auction_reserved(new.id) then raise exception 'STOCK_RESERVED'; end if;
 end if;
 return new;
end $$;
create trigger auction_sale_stock before insert on public.treasury_sales for each row execute function private.guard_auction_stock();
create trigger auction_loot_stock before update on public.treasury_loot for each row execute function private.guard_auction_stock();
revoke all on function private.auction_reserved(uuid),private.guard_auction_stock() from public,anon,authenticated;
create function public.record_inventory_sale(p_request uuid,p_loot uuid,p_version integer,p_quantity integer,p_gross bigint,p_buyer text) returns uuid language plpgsql security definer set search_path='' as $$
declare l public.treasury_loot;s public.treasury_sales;result uuid;
begin
 select * into l from public.treasury_loot where id=p_loot;
 perform private.lock_treasury(l.guild_id);
 if length(btrim(coalesce(p_buyer,''))) not between 2 and 80 then raise exception 'BUYER_REQUIRED'; end if;
 select * into s from public.treasury_sales where id=p_request;
 if s.id is not null and (s.buyer_name<>btrim(p_buyer) or s.sale_channel<>'direct') then raise exception 'REQUEST_CONFLICT'; end if;
 result:=public.sell_treasury_loot(p_request,p_loot,p_version,p_quantity,p_gross,'Продажа: '||btrim(p_buyer));
 update public.treasury_sales set buyer_name=btrim(p_buyer) where id=result;
 return result;
end $$;
create function public.list_inventory_auction(p_request uuid,p_loot uuid,p_version integer,p_quantity integer,p_unit_price bigint) returns uuid language plpgsql security definer set search_path='' as $$
declare l public.treasury_loot;a public.inventory_auctions;
begin
 select * into l from public.treasury_loot where id=p_loot;perform private.lock_treasury(l.guild_id);
 select * into l from public.treasury_loot where id=p_loot for update;
 if p_request is null or p_quantity is null or p_quantity not between 1 and 1000000 or p_unit_price is null or p_unit_price not between 1 and 100000000000000 then raise exception 'INVALID_INPUT'; end if;
 select * into a from public.inventory_auctions where id=p_request;
 if a.id is not null then
  if a.guild_id=l.guild_id and a.loot_id=l.id and a.quantity=p_quantity and a.unit_price_units=p_unit_price then return a.id; end if;
  raise exception 'REQUEST_CONFLICT';
 end if;
 if l.version is distinct from p_version then raise exception 'STALE_VERSION'; end if;
 if p_quantity>l.quantity_remaining-private.auction_reserved(l.id) then raise exception 'INSUFFICIENT_STOCK'; end if;
 insert into public.inventory_auctions(id,guild_id,loot_id,quantity,quantity_remaining,unit_price_units,created_by) values(p_request,l.guild_id,l.id,p_quantity,p_quantity,p_unit_price,private.viewer_id());
 update public.treasury_loot set version=version+1 where id=l.id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(l.guild_id,private.viewer_id(),'inventory.auction_listed',p_request,jsonb_build_object('loot_id',l.id,'quantity',p_quantity,'unit_price_units',p_unit_price::text));
 return p_request;
end $$;
create function public.cancel_inventory_auction(p_auction uuid,p_version integer) returns void language plpgsql security definer set search_path='' as $$
declare a public.inventory_auctions;
begin
 select * into a from public.inventory_auctions where id=p_auction;perform private.lock_treasury(a.guild_id);
 select * into a from public.inventory_auctions where id=p_auction for update;
 if a.status='cancelled' then return; end if;
 if a.status<>'active' then raise exception 'AUCTION_CLOSED'; end if;
 if a.version is distinct from p_version then raise exception 'STALE_VERSION'; end if;
 update public.inventory_auctions set status='cancelled',version=version+1 where id=a.id;
 update public.treasury_loot set version=version+1 where id=a.loot_id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(a.guild_id,private.viewer_id(),'inventory.auction_cancelled',a.id,jsonb_build_object('quantity',a.quantity_remaining));
end $$;
create function public.complete_inventory_auction(p_request uuid,p_auction uuid,p_version integer,p_loot_version integer,p_quantity integer,p_gross bigint,p_buyer text) returns uuid language plpgsql security definer set search_path='' as $$
declare a public.inventory_auctions;s public.treasury_sales;result uuid;
begin
 select * into a from public.inventory_auctions where id=p_auction;perform private.lock_treasury(a.guild_id);
 select * into a from public.inventory_auctions where id=p_auction for update;
 if length(btrim(coalesce(p_buyer,''))) not between 2 and 80 then raise exception 'BUYER_REQUIRED'; end if;
 select * into s from public.treasury_sales where id=p_request;
 if s.id is not null then
  if exists(select 1 from public.inventory_auction_sales where sale_id=s.id and auction_id=a.id) and s.quantity=p_quantity and s.gross_units=p_gross and s.buyer_name=btrim(p_buyer) and s.voided_at is null then return s.id; end if;
  raise exception 'REQUEST_CONFLICT';
 end if;
 if a.status<>'active' then raise exception 'AUCTION_CLOSED'; end if;
 if a.version is distinct from p_version then raise exception 'STALE_VERSION'; end if;
 if p_quantity is null or p_quantity not between 1 and a.quantity_remaining then raise exception 'INVALID_QUANTITY'; end if;
 update public.inventory_auctions set quantity_remaining=quantity_remaining-p_quantity,status=case when quantity_remaining=p_quantity then 'sold' else 'active' end,version=version+1 where id=a.id;
 result:=public.sell_treasury_loot(p_request,a.loot_id,p_loot_version,p_quantity,p_gross,'Продажа с аукциона: '||btrim(p_buyer));
 update public.treasury_sales set buyer_name=btrim(p_buyer),sale_channel='auction' where id=result;
 insert into public.inventory_auction_sales(sale_id,guild_id,auction_id) values(result,a.guild_id,a.id);
 return result;
end $$;
create function public.discard_inventory_stock(p_request uuid,p_loot uuid,p_version integer,p_quantity integer,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare l public.treasury_loot;d public.inventory_disposals;
begin
 select * into l from public.treasury_loot where id=p_loot;perform private.lock_treasury(l.guild_id);
 select * into l from public.treasury_loot where id=p_loot for update;
 if p_request is null or p_quantity is null or p_quantity not between 1 and 1000000 or length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'INVALID_INPUT'; end if;
 select * into d from public.inventory_disposals where id=p_request;
 if d.id is not null then
  if d.guild_id=l.guild_id and d.loot_id=l.id and d.quantity=p_quantity and d.reason=btrim(p_reason) then return d.id; end if;
  raise exception 'REQUEST_CONFLICT';
 end if;
 if l.version is distinct from p_version then raise exception 'STALE_VERSION'; end if;
 if p_quantity>l.quantity_remaining-private.auction_reserved(l.id) then raise exception 'INSUFFICIENT_STOCK'; end if;
 insert into public.inventory_disposals(id,guild_id,loot_id,quantity,reason,created_by) values(p_request,l.guild_id,l.id,p_quantity,btrim(p_reason),private.viewer_id());
 update public.treasury_loot set quantity_remaining=quantity_remaining-p_quantity,version=version+1 where id=l.id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(l.guild_id,private.viewer_id(),'inventory.stock_discarded',p_request,jsonb_build_object('loot_id',l.id,'quantity',p_quantity,'reason',btrim(p_reason),'before_remaining',l.quantity_remaining));
 return p_request;
end $$;
revoke all on function public.record_inventory_sale(uuid,uuid,integer,integer,bigint,text),public.list_inventory_auction(uuid,uuid,integer,integer,bigint),public.cancel_inventory_auction(uuid,integer),public.complete_inventory_auction(uuid,uuid,integer,integer,integer,bigint,text),public.discard_inventory_stock(uuid,uuid,integer,integer,text) from public,anon;
grant execute on function public.record_inventory_sale(uuid,uuid,integer,integer,bigint,text),public.list_inventory_auction(uuid,uuid,integer,integer,bigint),public.cancel_inventory_auction(uuid,integer),public.complete_inventory_auction(uuid,uuid,integer,integer,integer,bigint,text),public.discard_inventory_stock(uuid,uuid,integer,integer,text) to authenticated;
-- Reserved quantities are visible to inventory readers, without exposing a writable helper.
create or replace view public.treasury_inventory with(security_invoker=true) as
select l.id,l.guild_id,l.event_id,l.source,l.name,l.category,l.quantity_total,l.quantity_remaining,
 l.estimated_unit_units::text estimated_unit_units,(l.quantity_remaining*l.estimated_unit_units::numeric)::text estimated_total_units,
 l.note,l.version,l.created_at,e.title event_title,e.starts_at event_starts_at,l.archived_period,l.catalog_id,
 coalesce(a.reserved,0)::integer auction_quantity,(l.quantity_remaining-coalesce(a.reserved,0))::integer available_quantity
from public.treasury_loot l join public.events e on e.id=l.event_id and e.guild_id=l.guild_id
left join lateral(select sum(quantity_remaining) reserved from public.inventory_auctions where loot_id=l.id and status='active') a on true;
create or replace view public.treasury_sales_log with(security_invoker=true) as
select s.id,s.guild_id,s.loot_id,s.source,s.quantity,s.gross_units::text gross_units,s.guild_units::text guild_units,s.fund_units::text fund_units,
 s.note,s.created_at,s.created_by,s.voided_at,s.voided_by,s.void_reason,l.name item_name,l.event_id,e.title event_title,s.buyer_name,s.sale_channel
from public.treasury_sales s join public.treasury_loot l on l.id=s.loot_id and l.guild_id=s.guild_id join public.events e on e.id=l.event_id and e.guild_id=l.guild_id;
commit;
