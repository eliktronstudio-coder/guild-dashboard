begin;
-- Apply the new rule to legacy pending lots using the currently authenticated
-- treasury manager, preserving a truthful actor and the original saved price.
create function public.sell_pending_auction_now(p_auction uuid,p_version integer) returns uuid language plpgsql security definer set search_path='' as $$
declare a public.inventory_auctions;l public.treasury_loot;s public.treasury_sales;total numeric;
begin
 select * into a from public.inventory_auctions where id=p_auction;
 perform private.lock_treasury(a.guild_id);
 select * into a from public.inventory_auctions where id=p_auction for update;
 select * into s from public.treasury_sales where id=p_auction;
 if s.id is not null then
  if s.guild_id=a.guild_id and s.loot_id=a.loot_id and s.sale_channel='auction' and s.buyer_name='Аукцион' and s.voided_at is null and exists(select 1 from public.inventory_auction_sales where sale_id=s.id and auction_id=a.id) then return s.id; end if;
  raise exception 'REQUEST_CONFLICT';
 end if;
 if a.status='cancelled' then return a.id; end if;
 if a.status<>'active' then raise exception 'AUCTION_CLOSED'; end if;
 if a.version is distinct from p_version then raise exception 'STALE_VERSION'; end if;
 total:=a.quantity_remaining::numeric*a.unit_price_units::numeric;
 if total not between 1 and 100000000000000 then raise exception 'INVALID_AMOUNT'; end if;
 select * into l from public.treasury_loot where id=a.loot_id;
 return public.complete_inventory_auction(a.id,a.id,a.version,l.version,a.quantity_remaining,total::bigint,'Аукцион');
end $$;
revoke all on function public.sell_pending_auction_now(uuid,integer) from public,anon;
grant execute on function public.sell_pending_auction_now(uuid,integer) to authenticated;
commit;
