begin;
drop policy drop_registry_read on public.guild_drop_registry;
create policy drop_registry_read on public.guild_drop_registry for select to authenticated using(public.has_permission(guild_id,'drops.manage') or public.has_permission(guild_id,'treasury.manage'));
alter table public.events add column inventory_receipt boolean not null default false;
create function public.add_registry_inventory(p_request uuid,p_event uuid,p_catalog uuid,p_catalog_version integer,p_source text,p_price bigint,p_quantity integer,p_note text) returns uuid language plpgsql security definer set search_path='' as $$
declare g uuid; m uuid; item public.guild_drop_registry; event_id uuid; e public.events; l public.treasury_loot;
begin
 select guild_id,id into g,m from public.memberships where user_id=private.viewer_id() and status='active' limit 1;
 perform private.lock_finance(g,'treasury.manage');
 if p_request is null or p_source is null or p_source not in ('prime','mini_rb') or p_price is null or p_price not between 0 and 100000000000000 or p_quantity is null or p_quantity not between 1 and 1000000 or p_note is null or length(p_note)>1000 then raise exception 'INVALID_INPUT'; end if;
 select * into l from public.treasury_loot where id=p_request;
 if l.id is not null then
  if l.guild_id=g and l.catalog_id=p_catalog and l.source=p_source and l.estimated_unit_units=p_price and l.quantity_total=p_quantity and l.note=btrim(p_note) and l.event_id=coalesce(p_event,p_request) then return l.id; end if;
  raise exception 'REQUEST_CONFLICT';
 end if;
 select * into item from public.guild_drop_registry where id=p_catalog and guild_id=g for share;
 if item.id is null or item.version is distinct from p_catalog_version then raise exception 'STALE_VERSION'; end if;
 event_id:=coalesce(p_event,p_request);
 if p_event is null then
  insert into public.events(id,guild_id,title,kind,starts_at,status,organizer_id,counts_for_attendance,treasury_source,description,inventory_receipt)
  values(event_id,g,'Из Сундука','guild',now(),'completed',m,false,p_source,'Поступление из сундука; не учитывается в посещаемости.',true);
 else
  select * into e from public.events where id=event_id and guild_id=g and deleted_at is null;
  if e.id is null or e.treasury_source<>p_source then raise exception 'SOURCE_REQUIRED'; end if;
 end if;
 perform public.add_treasury_loot(p_request,event_id,item.name,case when p_source='prime' then 'Прайм' else 'Мини РБ' end,p_quantity,p_price,p_note);
 update public.treasury_loot set catalog_id=item.id,catalog_photo=item.photo where id=p_request;
 return p_request;
end $$;
revoke all on function public.add_registry_inventory(uuid,uuid,uuid,integer,text,bigint,integer,text) from public,anon;
grant execute on function public.add_registry_inventory(uuid,uuid,uuid,integer,text,bigint,integer,text) to authenticated;
create or replace function public.activity_journal(p_from timestamptz,p_until timestamptz,p_filters jsonb default '{}',p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare g uuid;staff boolean;finance boolean;result jsonb;
begin
 select id into g from public.guilds where slug='xd';
 if not private.is_member(g) then raise exception 'FORBIDDEN'; end if;
 staff:=public.has_permission(g,'attendance.manage');finance:=private.finance_staff(g);
 if p_from is null or p_until is null or p_from>=p_until or p_until-p_from>interval '366 days' or p_page not between 1 and 10000 then raise exception 'INVALID_PERIOD'; end if;
 if coalesce(p_filters->>'player','')<>'' and not staff then raise exception 'FORBIDDEN'; end if;
 with base as (
  select e.id,e.title,e.kind,e.starts_at,e.status,e.treasury_source,e.attendance_finalized_at,e.version,e.activity_banner_id,
   coalesce(r.difficulty,'normal') as difficulty,coalesce(r.is_night,false) as is_night,
   e.activity_banner_photo is not null and e.activity_banner_photo<>'' as has_banner,
   case when staff then case when e.status='scheduled' then (select count(*) from public.event_signups s where s.event_id=e.id) else (select count(*) from public.attendance a where a.event_id=e.id and a.mark='present') end end as participants,
   case when staff and e.attendance_finalized_at is not null and e.status='completed' then (select round(100.0*count(*) filter(where a.mark='present')/nullif(count(*) filter(where a.mark in ('present','absent')),0),1) from public.attendance a where a.event_id=e.id) end as percentage,
   case when finance then (select coalesce(sum(w.amount_units),0) from public.treasury_awards w join public.treasury_allocations x on x.id=w.allocation_id and x.voided_at is null join public.treasury_sales s on s.id=x.sale_id and s.voided_at is null join public.treasury_loot l on l.id=s.loot_id where l.event_id=e.id) end as awarded,
   case when finance then (select coalesce(sum((select coalesce(sum(p.amount_units),0) from public.treasury_payouts p where p.award_id=w.id and p.voided_at is null)),0) from public.treasury_awards w join public.treasury_allocations x on x.id=w.allocation_id and x.voided_at is null join public.treasury_sales s on s.id=x.sale_id and s.voided_at is null join public.treasury_loot l on l.id=s.loot_id where l.event_id=e.id) end as paid
  from public.events e left join public.activity_reports r on r.event_id=e.id
  where e.guild_id=g and e.deleted_at is null and not e.inventory_receipt and e.starts_at>=p_from and e.starts_at<p_until
   and (coalesce(p_filters->>'source','')='' or e.treasury_source=p_filters->>'source')
   and (coalesce(p_filters->>'kind','')='' or (case when e.kind='pvp' then 'pvp' else 'pve' end)=p_filters->>'kind')
   and (coalesce(p_filters->>'banner','')='' or e.activity_banner_id=(p_filters->>'banner')::uuid)
   and (coalesce(p_filters->>'player','')='' or exists(select 1 from public.attendance a join public.memberships m on m.id=a.membership_id where a.event_id=e.id and a.mark='present' and strpos(lower(m.nickname),lower(p_filters->>'player'))>0) or exists(select 1 from public.event_signups s join public.memberships m on m.id=s.membership_id where s.event_id=e.id and strpos(lower(m.nickname),lower(p_filters->>'player'))>0))
 ), labelled as (
  select *,case when status='cancelled' then 'cancelled' when status='scheduled' then 'scheduled' when awarded>paid then 'pending_payout' when awarded>0 and paid>=awarded then 'paid' when attendance_finalized_at is null then 'unconfirmed' else 'completed' end as journal_status from base
 ), filtered as (
  select * from labelled where coalesce(p_filters->>'status','')='' or journal_status=p_filters->>'status' or (p_filters->>'status'='all_completed' and status='completed')
 ), paged as (select * from filtered order by starts_at desc,id desc offset (p_page-1)*15 limit 15)
 select jsonb_build_object('total',(select count(*) from filtered),'page',p_page,'can_view_roster',staff,'kpis',jsonb_build_object('total',(select count(*) from filtered),'average',(select round(avg(participants),1) from filtered where status='completed' and attendance_finalized_at is not null),'best',(select max(participants) from filtered where status='completed' and attendance_finalized_at is not null),'cancelled',(select count(*) from filtered where status='cancelled')),'rows',coalesce((select jsonb_agg(to_jsonb(p)-'awarded'-'paid' order by p.starts_at desc,p.id desc) from paged p),'[]')) into result;
 return result;
end $$;


commit;
