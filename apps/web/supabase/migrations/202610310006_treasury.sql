begin;
insert into public.permissions(key) values ('treasury.read'),('treasury.manage');
insert into public.role_permissions(role_id,permission)
select id,'treasury.read' from public.roles where code in ('owner','admin','officer','treasurer','member');
insert into public.role_permissions(role_id,permission)
select id,'treasury.manage' from public.roles where code in ('owner','admin','treasurer');
alter table public.events add column treasury_source text not null default 'none'
 check(treasury_source in ('none','prime','mini_rb'));

-- Money is an integer number of 1/10000 gold. API views return money as text.
create table public.treasury_loot (
 id uuid primary key, guild_id uuid not null references public.guilds(id), event_id uuid not null,
 source text not null check(source in ('prime','mini_rb')),
 name text not null check(char_length(btrim(name)) between 2 and 120),
 category text not null default '' check(char_length(category)<=80),
 quantity_total integer not null check(quantity_total between 0 and 1000000),
 quantity_remaining integer not null check(quantity_remaining between 0 and quantity_total),
 estimated_unit_units bigint check(estimated_unit_units between 0 and 100000000000000),
 note text not null default '' check(char_length(note)<=1000),
 version integer not null default 1 check(version>0),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 unique(guild_id,id), foreign key(guild_id,event_id) references public.events(guild_id,id)
);
create table public.treasury_sales (
 id uuid primary key, guild_id uuid not null, loot_id uuid not null,
 source text not null check(source in ('prime','mini_rb')),
 quantity integer not null check(quantity between 1 and 1000000),
 gross_units bigint not null check(gross_units between 1 and 100000000000000),
 guild_units bigint not null check(guild_units>=0),
 fund_units bigint not null check(fund_units>=0),
 note text not null default '' check(char_length(note)<=500),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 voided_at timestamptz, voided_by uuid references public.profiles(id), void_reason text,
 foreign key(guild_id,loot_id) references public.treasury_loot(guild_id,id),
 check(gross_units=guild_units+fund_units),
 check(guild_units=case when source='prime' then gross_units*3/10 else 0 end),
 check((voided_at is null and voided_by is null and void_reason is null) or
       (voided_at is not null and voided_by is not null and char_length(btrim(void_reason)) between 3 and 500))
);
create index treasury_loot_inventory on public.treasury_loot(guild_id,source,created_at desc,id);
create index treasury_loot_event on public.treasury_loot(event_id);
create index treasury_sales_history on public.treasury_sales(guild_id,created_at desc,id);
create index treasury_sales_loot on public.treasury_sales(loot_id);

create function private.lock_treasury(g uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if g is null or not public.has_permission(g,'treasury.manage') then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.guilds where id=g for update;
 if not public.has_permission(g,'treasury.manage') then raise exception 'FORBIDDEN'; end if;
end $$;
revoke all on function private.lock_treasury(uuid) from public,anon,authenticated;

create function public.tag_event_treasury(p_id uuid,p_version integer,p_source text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare e public.events;g uuid;
begin
 select guild_id into g from public.events where id=p_id;
 if g is null then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.guilds where id=g for update;
 if not(public.has_permission(g,'events.manage') or public.has_permission(g,'treasury.manage')) then raise exception 'FORBIDDEN'; end if;
 select * into e from public.events where id=p_id for update;
 if e.status='cancelled' then raise exception 'EVENT_CLOSED'; end if;
 if p_source is null or p_source not in ('none','prime','mini_rb') then raise exception 'INVALID_SOURCE'; end if;
 if e.treasury_source=p_source then return; end if;
 if e.version is distinct from p_version then raise exception 'STALE_VERSION'; end if;
 if exists(select 1 from public.treasury_loot where event_id=e.id) then raise exception 'SOURCE_LOCKED'; end if;
 if char_length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'REASON_REQUIRED'; end if;
 update public.events set treasury_source=p_source,version=version+1 where id=e.id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'event.treasury_tagged',e.id,
 jsonb_build_object('before',e.treasury_source,'after',p_source,'reason',btrim(p_reason)));
end $$;

create function public.add_treasury_loot(p_request_id uuid,p_event_id uuid,p_name text,p_category text,p_quantity integer,p_estimated_unit_units bigint,p_note text) returns uuid
language plpgsql security definer set search_path='' as $$
declare e public.events;l public.treasury_loot;g uuid;
begin
 select guild_id into g from public.events where id=p_event_id;
 perform private.lock_treasury(g);
 select * into e from public.events where id=p_event_id for update;
 if p_request_id is null then raise exception 'INVALID_INPUT'; end if;
 select * into l from public.treasury_loot where id=p_request_id;
 if l.id is not null then
  if l.guild_id=g and l.event_id=e.id and l.name=btrim(p_name) and l.category=btrim(p_category) and l.quantity_total=p_quantity
     and l.estimated_unit_units is not distinct from p_estimated_unit_units and l.note=btrim(p_note) then return l.id; end if;
  raise exception 'REQUEST_CONFLICT';
 end if;
 if e.status<>'completed' or e.starts_at>now() then raise exception 'EVENT_NOT_COMPLETED'; end if;
 if e.treasury_source='none' then raise exception 'SOURCE_REQUIRED'; end if;
 if p_quantity is null or p_quantity not between 1 and 1000000 then raise exception 'INVALID_QUANTITY'; end if;
 insert into public.treasury_loot(id,guild_id,event_id,source,name,category,quantity_total,quantity_remaining,estimated_unit_units,note,created_by)
 values(p_request_id,g,e.id,e.treasury_source,btrim(p_name),btrim(p_category),p_quantity,p_quantity,p_estimated_unit_units,btrim(p_note),private.viewer_id());
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'treasury.loot_added',p_request_id,
 jsonb_build_object('event_id',e.id,'source',e.treasury_source,'quantity',p_quantity,'estimated_unit_units',p_estimated_unit_units));
 return p_request_id;
end $$;

create function public.revise_treasury_loot(p_id uuid,p_version integer,p_name text,p_category text,p_quantity integer,p_estimated_unit_units bigint,p_note text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare l public.treasury_loot;g uuid;sold integer;
begin
 select guild_id into g from public.treasury_loot where id=p_id;
 perform private.lock_treasury(g);
 select * into l from public.treasury_loot where id=p_id for update;
 if l.version is distinct from p_version then raise exception 'STALE_VERSION'; end if;
 if char_length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'REASON_REQUIRED'; end if;
 sold:=l.quantity_total-l.quantity_remaining;
 if p_quantity is null or p_quantity not between sold and 1000000 then raise exception 'QUANTITY_BELOW_SOLD'; end if;
 update public.treasury_loot set name=btrim(p_name),category=btrim(p_category),quantity_total=p_quantity,quantity_remaining=p_quantity-sold,
 estimated_unit_units=p_estimated_unit_units,note=btrim(p_note),version=version+1 where id=l.id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'treasury.loot_revised',l.id,
 jsonb_build_object('before',to_jsonb(l),'after',(select to_jsonb(x) from public.treasury_loot x where id=l.id),'reason',btrim(p_reason)));
end $$;

create function public.sell_treasury_loot(p_request_id uuid,p_loot_id uuid,p_version integer,p_quantity integer,p_gross_units bigint,p_note text) returns uuid
language plpgsql security definer set search_path='' as $$
declare l public.treasury_loot;s public.treasury_sales;g uuid;share bigint;
begin
 select guild_id into g from public.treasury_loot where id=p_loot_id;
 perform private.lock_treasury(g);
 select * into l from public.treasury_loot where id=p_loot_id for update;
 if p_request_id is null then raise exception 'INVALID_INPUT'; end if;
 select * into s from public.treasury_sales where id=p_request_id;
 if s.id is not null then
  if s.guild_id=g and s.loot_id=l.id and s.quantity=p_quantity and s.gross_units=p_gross_units and s.note=btrim(p_note) then
   if s.voided_at is not null then raise exception 'SALE_VOIDED'; end if;
   return s.id;
  end if;
  raise exception 'REQUEST_CONFLICT';
 end if;
 if l.version is distinct from p_version then raise exception 'STALE_VERSION'; end if;
 if p_quantity is null or p_quantity not between 1 and l.quantity_remaining then raise exception 'INSUFFICIENT_STOCK'; end if;
 if p_gross_units is null or p_gross_units not between 1 and 100000000000000 then raise exception 'INVALID_AMOUNT'; end if;
 share:=case when l.source='prime' then p_gross_units*3/10 else 0 end;
 insert into public.treasury_sales(id,guild_id,loot_id,source,quantity,gross_units,guild_units,fund_units,note,created_by)
 values(p_request_id,g,l.id,l.source,p_quantity,p_gross_units,share,p_gross_units-share,btrim(p_note),private.viewer_id());
 update public.treasury_loot set quantity_remaining=quantity_remaining-p_quantity,version=version+1 where id=l.id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'treasury.sold',p_request_id,
 jsonb_build_object('loot_id',l.id,'source',l.source,'quantity',p_quantity,'gross_units',p_gross_units,'guild_units',share,'fund_units',p_gross_units-share));
 return p_request_id;
end $$;

create function public.void_treasury_sale(p_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare s public.treasury_sales;g uuid;
begin
 select guild_id into g from public.treasury_sales where id=p_id;
 perform private.lock_treasury(g);
 select * into s from public.treasury_sales where id=p_id for update;
 if s.voided_at is not null then return; end if;
 if char_length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'REASON_REQUIRED'; end if;
 -- Same guild lock as sale/revision prevents overselling and conflicting restoration.
 perform 1 from public.treasury_loot where id=s.loot_id for update;
 update public.treasury_sales set voided_at=now(),voided_by=private.viewer_id(),void_reason=btrim(p_reason) where id=s.id;
 update public.treasury_loot set quantity_remaining=quantity_remaining+s.quantity,version=version+1 where id=s.loot_id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'treasury.sale_voided',s.id,
 jsonb_build_object('sale',to_jsonb(s),'reason',btrim(p_reason)));
end $$;

alter table public.treasury_loot enable row level security;
alter table public.treasury_sales enable row level security;
create policy loot_read on public.treasury_loot for select to authenticated using(public.has_permission(guild_id,'treasury.read'));
create policy sales_read on public.treasury_sales for select to authenticated using(public.has_permission(guild_id,'treasury.read'));
revoke all on public.treasury_loot,public.treasury_sales from public,anon,authenticated;
grant select on public.treasury_loot,public.treasury_sales to authenticated;

create view public.treasury_inventory with (security_invoker=true) as
select l.id,l.guild_id,l.event_id,l.source,l.name,l.category,l.quantity_total,l.quantity_remaining,
 l.estimated_unit_units::text estimated_unit_units,(l.quantity_remaining*l.estimated_unit_units::numeric)::text estimated_total_units,
 l.note,l.version,l.created_at,e.title event_title,e.starts_at event_starts_at
from public.treasury_loot l join public.events e on e.id=l.event_id and e.guild_id=l.guild_id;
create view public.treasury_sales_log with (security_invoker=true) as
select s.id,s.guild_id,s.loot_id,s.source,s.quantity,s.gross_units::text gross_units,s.guild_units::text guild_units,s.fund_units::text fund_units,
 s.note,s.created_at,s.created_by,s.voided_at,s.voided_by,s.void_reason,l.name item_name,l.event_id,e.title event_title
from public.treasury_sales s join public.treasury_loot l on l.id=s.loot_id and l.guild_id=s.guild_id
join public.events e on e.id=l.event_id and e.guild_id=l.guild_id;
revoke all on public.treasury_inventory,public.treasury_sales_log from public,anon;
grant select on public.treasury_inventory,public.treasury_sales_log to authenticated;

create function public.treasury_summary() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare g uuid;money jsonb;stock jsonb;
begin
 select id into g from public.guilds where slug='xd';
 if not public.has_permission(g,'treasury.read') then raise exception 'FORBIDDEN'; end if;
 select jsonb_build_object(
  'prime_units',coalesce(sum(fund_units) filter(where source='prime'),0)::text,
  'prime_gross_units',coalesce(sum(gross_units) filter(where source='prime'),0)::text,
  'mini_units',coalesce(sum(fund_units) filter(where source='mini_rb'),0)::text,
  'guild_units',coalesce(sum(guild_units),0)::text,
  'sales_count',count(*)) into money from public.treasury_sales where guild_id=g and voided_at is null;
 select jsonb_build_object(
  'inventory_units',coalesce(sum(quantity_remaining*estimated_unit_units::numeric),0)::text,
  'unpriced_count',count(*) filter(where estimated_unit_units is null),
  'priced_count',count(*) filter(where estimated_unit_units is not null),
  'stock_count',count(*),
  'general_units',coalesce(sum(quantity_remaining*estimated_unit_units::numeric) filter(where source='prime'),0)::text,
  'xd_units',coalesce(sum(quantity_remaining*estimated_unit_units::numeric) filter(where source='mini_rb'),0)::text
 ) into stock from public.treasury_loot where guild_id=g and quantity_remaining>0;
 return money||stock;
end $$;
revoke all on function public.tag_event_treasury(uuid,integer,text,text),public.add_treasury_loot(uuid,uuid,text,text,integer,bigint,text),
 public.revise_treasury_loot(uuid,integer,text,text,integer,bigint,text,text),public.sell_treasury_loot(uuid,uuid,integer,integer,bigint,text),
 public.void_treasury_sale(uuid,text),public.treasury_summary() from public,anon;
grant execute on function public.tag_event_treasury(uuid,integer,text,text),public.add_treasury_loot(uuid,uuid,text,text,integer,bigint,text),
 public.revise_treasury_loot(uuid,integer,text,text,integer,bigint,text,text),public.sell_treasury_loot(uuid,uuid,integer,integer,bigint,text),
 public.void_treasury_sale(uuid,text),public.treasury_summary() to authenticated;
commit;
