begin;
-- New listings are booked as sales atomically. Existing pending lots retain their
-- reservation records and may still be completed/cancelled through the old flow.
create function public.sell_inventory_auction_now(p_request uuid,p_loot uuid,p_version integer,p_quantity integer,p_unit_price bigint) returns uuid language plpgsql security definer set search_path='' as $$
declare l public.treasury_loot;a public.inventory_auctions;s public.treasury_sales;total numeric;
begin
 select * into l from public.treasury_loot where id=p_loot;
 perform private.lock_treasury(l.guild_id);
 if p_request is null or p_quantity is null or p_quantity not between 1 and 1000000 or p_unit_price is null or p_unit_price not between 1 and 100000000000000 then raise exception 'INVALID_INPUT'; end if;
 total:=p_quantity::numeric*p_unit_price::numeric;
 if total>100000000000000 then raise exception 'INVALID_AMOUNT'; end if;
 select * into a from public.inventory_auctions where id=p_request;
 if a.id is not null then
  select * into s from public.treasury_sales where id=p_request;
  if a.guild_id=l.guild_id and a.loot_id=l.id and a.quantity=p_quantity and a.unit_price_units=p_unit_price and a.status='sold' and s.loot_id=l.id and s.quantity=p_quantity and s.gross_units=total and s.sale_channel='auction' and s.buyer_name='Аукцион' and exists(select 1 from public.inventory_auction_sales where sale_id=s.id and auction_id=a.id) then
   if s.voided_at is not null then raise exception 'SALE_VOIDED'; end if;
   return s.id;
  end if;
  raise exception 'REQUEST_CONFLICT';
 end if;
 perform public.list_inventory_auction(p_request,p_loot,p_version,p_quantity,p_unit_price);
 select * into l from public.treasury_loot where id=p_loot;
 return public.complete_inventory_auction(p_request,p_request,1,l.version,p_quantity,total::bigint,'Аукцион');
end $$;
revoke all on function public.sell_inventory_auction_now(uuid,uuid,integer,integer,bigint) from public,anon;
grant execute on function public.sell_inventory_auction_now(uuid,uuid,integer,integer,bigint) to authenticated;
commit;
