begin;
-- Share the event lock, membership checks and audit between browser and bot.
create function private.set_member_event_signup(p_event uuid,p_member uuid,p_join boolean,p_via text,p_link uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare e public.events;m public.memberships;changed integer;
begin
 select * into e from public.events where id=p_event for update;
 select * into m from public.memberships where id=p_member;
 if e.id is null or m.id is null or e.guild_id<>m.guild_id or m.status<>'active' or not exists(select 1 from public.profiles p where p.id=m.user_id and not p.blocked)
 or (p_via='site' and m.user_id is distinct from private.viewer_id())
 or (p_link is not null and not exists(select 1 from private.telegram_links where id=p_link and membership_id=m.id)) then raise exception 'FORBIDDEN';end if;
 if e.status<>'scheduled' or e.starts_at<=clock_timestamp() then raise exception 'EVENT_CLOSED';end if;
 if p_join is null or p_via is null or p_via not in ('site','telegram') then raise exception 'INVALID_INPUT';end if;
 if p_join then insert into public.event_signups(guild_id,event_id,membership_id) values(e.guild_id,e.id,m.id) on conflict do nothing;
 else delete from public.event_signups where event_id=e.id and membership_id=m.id;end if;
 get diagnostics changed=row_count;
 if changed>0 then insert into public.audit_log(guild_id,actor_id,action,target_id,detail)
 values(e.guild_id,m.user_id,'event.signup_changed',e.id,jsonb_build_object('membership_id',m.id,'joined',p_join,'via',p_via));end if;
end $$;
revoke all on function private.set_member_event_signup(uuid,uuid,boolean,text,uuid) from public,anon,authenticated;
create or replace function public.set_event_signup(p_event_id uuid,p_join boolean) returns void language plpgsql security definer set search_path='' as $$
declare m uuid;
begin
 select id into m from public.memberships where user_id=private.viewer_id() and guild_id=(select guild_id from public.events where id=p_event_id) and status='active';
 perform private.set_member_event_signup(p_event_id,m,p_join,'site');
end $$;
-- Keep five-argument calls compatible through a default, with no ambiguous overload.
drop function public.receive_telegram_update(bigint,bigint,text,text,text);
create function public.receive_telegram_update(p_update bigint,p_telegram bigint,p_username text,p_command text,p_hash text default null,p_event uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare l private.telegram_links;r private.telegram_requests;code text:='help';linked uuid;
begin
 if p_update is null or p_update<0 or p_telegram is null or p_telegram<1 or p_telegram>9007199254740991 then raise exception 'INVALID_UPDATE';end if;
 perform pg_advisory_xact_lock(751924,(p_telegram%2147483647)::integer);
 insert into private.telegram_updates(update_id,telegram_id) values(p_update,p_telegram) on conflict do nothing;
 if not found then return;end if;
 if (select count(*) from private.telegram_updates where telegram_id=p_telegram and created_at>now()-interval '1 minute')>10 then return;end if;
 delete from private.telegram_updates where created_at<now()-interval '7 days';
 delete from private.telegram_requests where expires_at<now()-interval '1 day';
 delete from private.telegram_outbox where status in ('sent','failed','cancelled') and created_at<now()-interval '30 days';
 select * into l from private.telegram_links where telegram_id=p_telegram;
 if l.id is not null and private.telegram_active(l.membership_id) then linked:=l.id;end if;
 if p_command='link' then
  select * into r from private.telegram_requests where token_hash=p_hash and expires_at>now() for update;
  code:='link_invalid';
  if r.id is not null and private.telegram_active(r.membership_id) and (r.telegram_id is null or r.telegram_id=p_telegram)
    and not exists(select 1 from private.telegram_links where telegram_id=p_telegram or membership_id=r.membership_id) then
   update private.telegram_requests set telegram_id=p_telegram,username=case when p_username ~ '^[A-Za-z0-9_]{1,32}$' then p_username end where id=r.id;
   code:='link_received';
  end if;
 elsif p_command='stop' and l.id is not null then
  update private.telegram_links set notifications=false where id=l.id;
  update private.telegram_outbox set status='cancelled' where link_id=l.id and kind<>'reply' and status='pending';
  code:='stopped';
 elsif p_command='unlink' and l.id is not null then
  update private.telegram_outbox set status='cancelled' where link_id=l.id and status='pending';
  delete from private.telegram_links where id=l.id;
  delete from private.telegram_requests where membership_id=l.membership_id;
  insert into public.audit_log(guild_id,actor_id,action,target_id) select guild_id,user_id,'telegram.unlinked_via_bot',id from public.memberships where id=l.membership_id;
  linked:=null;code:='unlinked';
 elsif linked is null then code:='not_linked';
 elsif p_command in ('join','leave') then
  begin
   perform private.set_member_event_signup(p_event,l.membership_id,p_command='join','telegram',l.id);
   code:='signup_status';
  exception when raise_exception then
   if sqlerrm in ('FORBIDDEN','EVENT_CLOSED','INVALID_INPUT') then code:='event_unavailable';else raise;end if;
  end;
 elsif p_command='signup_help' then code:='signup_help';
 elsif p_command='events' then code:='events';
 elsif p_command='cabinet' then code:='cabinet';
 end if;
 insert into private.telegram_outbox(dedupe,chat_id,link_id,kind,payload) values('update:'||p_update,p_telegram,linked,'reply',jsonb_build_object('code',code,'telegram_id',p_telegram::text,'event_id',case when code='signup_status' then p_event end));
end $$;


alter table private.telegram_outbox drop constraint telegram_outbox_kind_check;
alter table private.telegram_outbox add constraint telegram_outbox_kind_check check(kind in ('reply','event','award','award_cancelled','payout','payout_cancelled'));
create function private.queue_telegram_payout() returns trigger language plpgsql security definer set search_path='' as $$
declare kind_name text;
begin
 if tg_op='INSERT' then
  if new.voided_at is not null then return new;end if;
  kind_name:='payout';
 else
  if old.voided_at is not null or new.voided_at is null then return new;end if;
  kind_name:='payout_cancelled';
 end if;
 insert into private.telegram_outbox(dedupe,chat_id,link_id,kind,payload)
 select kind_name||':'||new.id||':'||l.id,l.telegram_id,l.id,kind_name,jsonb_build_object('payout_id',new.id)
 from public.treasury_awards w join private.telegram_links l on l.membership_id=w.membership_id
 where w.id=new.award_id and l.notifications and private.telegram_active(l.membership_id)
 on conflict(dedupe) do nothing;
 return new;
end $$;
create trigger telegram_payout after insert or update on public.treasury_payouts for each row execute function private.queue_telegram_payout();
revoke all on function private.queue_telegram_payout() from public,anon,authenticated;
create or replace function public.claim_telegram_delivery() returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare job private.telegram_outbox;l private.telegram_links;body jsonb;event public.events;amount text;is_void boolean;owner uuid;token uuid;remaining text;
begin
 -- Serialize claims across all server instances; at most one network send is in flight.
 perform pg_advisory_xact_lock(751923,6);
 update private.telegram_outbox set status=case when attempts>=5 then 'failed' else 'pending' end,error_code='LEASE_EXPIRED',lease=null,lease_until=null
 where status='sending' and lease_until<=now();
 if exists(select 1 from private.telegram_outbox where status='sending') then return null;end if;
 update private.telegram_outbox set status='cancelled' where status='pending' and
 (created_at<now()-interval '1 day' or (kind='reply' and created_at<now()-interval '10 minutes') or
 (link_id is not null and not exists(select 1 from private.telegram_links linked_row where linked_row.id=link_id and private.telegram_active(linked_row.membership_id) and (kind='reply' or linked_row.notifications))));
 if exists(select 1 from private.telegram_outbox where attempted_at>now()-interval '50 milliseconds') then return jsonb_build_object('wait_ms',100);end if;
 for job in select * from private.telegram_outbox o where status='pending' and available_at<=now()
  and not exists(select 1 from private.telegram_outbox recent where recent.chat_id=o.chat_id and recent.attempted_at>now()-interval '1 second')
  order by created_at,id limit 25 for update skip locked loop
  l:=null;body:=null;
  if job.link_id is not null then select * into l from private.telegram_links where id=job.link_id;end if;
  if job.kind='reply' then
   body:=job.payload;
   if job.payload->>'code'='events' then
    if l.id is null then body:=null;
    else
     body:=body||jsonb_build_object('events',coalesce((select jsonb_agg(to_jsonb(e) order by starts_at,id) from
      (select e.id,e.title,e.starts_at,exists(select 1 from public.event_signups s where s.event_id=e.id and s.membership_id=l.membership_id) signed_up from public.events e join public.memberships m on m.guild_id=e.guild_id where m.id=l.membership_id and e.status='scheduled' and e.starts_at>now() order by starts_at,id limit 5) e),'[]'::jsonb));
    end if;
   elsif job.payload->>'code'='signup_status' then
    select e.* into event from public.events e join public.memberships m on m.guild_id=e.guild_id where e.id=(job.payload->>'event_id')::uuid and m.id=l.membership_id;
    if not found then body:=null;
    else body:=jsonb_build_object('code','signup_status','id',event.id,'title',event.title,'status',event.status,'starts_at',event.starts_at,
     'signed_up',exists(select 1 from public.event_signups s where s.event_id=event.id and s.membership_id=l.membership_id));end if;
   end if;
  elsif job.kind='event' then
   select e.* into event from public.events e join public.memberships m on m.guild_id=e.guild_id where e.id=(job.payload->>'event_id')::uuid and m.id=l.membership_id;
   if found then body:=jsonb_build_object('code','event','id',event.id,'title',event.title,'starts_at',event.starts_at,'status',event.status,'signed_up',exists(select 1 from public.event_signups s where s.event_id=event.id and s.membership_id=l.membership_id));end if;
  elsif job.kind in ('payout','payout_cancelled') then
   select p.amount_units::text,p.voided_at is not null,w.membership_id,
    (case when a.voided_at is not null then 0 else w.amount_units-(select coalesce(sum(paid.amount_units),0) from public.treasury_payouts paid where paid.award_id=w.id and paid.voided_at is null) end)::text
   into amount,is_void,owner,remaining from public.treasury_payouts p
   join public.treasury_awards w on w.id=p.award_id join public.treasury_allocations a on a.id=w.allocation_id
   where p.id=(job.payload->>'payout_id')::uuid;
   if found and owner=l.membership_id and ((job.kind='payout' and not is_void) or (job.kind='payout_cancelled' and is_void)) then
    body:=jsonb_build_object('code',job.kind,'amount_units',amount,'pending_units',remaining);
   end if;
  else
   select w.amount_units::text,a.voided_at is not null,w.membership_id into amount,is_void,owner
    from public.treasury_awards w join public.treasury_allocations a on a.id=w.allocation_id where w.id=(job.payload->>'award_id')::uuid;
   if found and owner=l.membership_id and ((job.kind='award' and not is_void) or (job.kind='award_cancelled' and is_void)) then
    body:=jsonb_build_object('code',job.kind,'amount_units',amount);
   end if;
  end if;
  if body is null then update private.telegram_outbox set status='cancelled' where id=job.id;continue;end if;
  token:=gen_random_uuid();
  update private.telegram_outbox set status='sending',lease=token,lease_until=now()+interval '2 minutes',attempted_at=now(),attempts=attempts+1 where id=job.id;
  return jsonb_build_object('id',job.id,'lease',token,'chat_id',job.chat_id::text,'body',body);
 end loop;
 if exists(select 1 from private.telegram_outbox where status='pending' and available_at<=now()+interval '1 second') then return jsonb_build_object('wait_ms',1000);end if;
 return null;
end $$;

revoke all on function public.receive_telegram_update(bigint,bigint,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.receive_telegram_update(bigint,bigint,text,text,text,uuid) to service_role;
commit;
