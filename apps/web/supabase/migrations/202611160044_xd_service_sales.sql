begin;
-- Use the existing sale ledger and its cash, payroll, audit and reversal rules.
-- A non-attendance receipt represents one service/bulk sale, not physical drop.
create function public.record_xd_service_sale(p_request uuid,p_kind text,p_gross bigint,p_buyer text,p_note text) returns uuid
language plpgsql security definer set search_path='' as $$
declare g uuid;m uuid;label text;s public.treasury_sales;l public.treasury_loot;
begin
 select guild_id,id into g,m from public.memberships where user_id=private.viewer_id() and status='active' limit 1;
 perform private.lock_finance(g,'treasury.manage');
 if p_request is null or p_kind is null or p_kind not in ('rb_experience','trash') or p_gross is null or p_gross not between 1 and 100000000000000
    or p_note is null or length(p_note)>400 or length(btrim(coalesce(p_buyer,''))) not between 2 and 80 then raise exception 'INVALID_INPUT'; end if;
 label:=case when p_kind='rb_experience' then 'Продажа РБ опыта' else 'Продажа мусора' end;
 select * into s from public.treasury_sales where id=p_request;
 if s.id is not null then
  select * into l from public.treasury_loot where id=s.loot_id;
  if s.guild_id is distinct from g or s.loot_id is distinct from p_request or s.source<>'mini_rb' or s.quantity<>1 or s.gross_units<>p_gross
     or s.buyer_name is distinct from btrim(p_buyer) or s.sale_channel<>'direct' or l.name<>label or l.category<>'Продажа ХД' or l.note<>btrim(p_note)
     or l.event_id<>p_request then raise exception 'REQUEST_CONFLICT'; end if;
  if s.voided_at is not null then raise exception 'SALE_VOIDED'; end if;
  return s.id;
 end if;
 if exists(select 1 from public.events where id=p_request) or exists(select 1 from public.treasury_loot where id=p_request) then raise exception 'REQUEST_CONFLICT'; end if;
 insert into public.events(id,guild_id,title,kind,starts_at,status,organizer_id,counts_for_attendance,treasury_source,description,inventory_receipt)
 values(p_request,g,label,'guild',now(),'completed',m,false,'mini_rb','Продажа ХД; не учитывается в посещаемости.',true);
 perform public.add_treasury_loot(p_request,p_request,label,'Продажа ХД',1,p_gross,btrim(p_note));
 update public.treasury_loot set xd_quantity=1,xd_received_at=now() where id=p_request;
 perform public.record_inventory_sale(p_request,p_request,1,1,p_gross,btrim(p_buyer));
 update public.treasury_sales set note=label||case when btrim(p_note)='' then '' else ' · '||btrim(p_note) end where id=p_request;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail)
 values(g,private.viewer_id(),'treasury.xd_service_sold',p_request,jsonb_build_object('kind',p_kind,'source','mini_rb','gross_units',p_gross,'buyer',btrim(p_buyer),'note',btrim(p_note)));
 return p_request;
end $$;
revoke all on function public.record_xd_service_sale(uuid,text,bigint,text,text) from public,anon;
grant execute on function public.record_xd_service_sale(uuid,text,bigint,text,text) to authenticated;
commit;
