begin;
-- Read only the current binding's own data. No viewer impersonation or browser grant.
create function private.telegram_personal_stats(p_link uuid,p_from timestamptz,p_until timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare me uuid;g uuid;result jsonb;
begin
 select l.membership_id,m.guild_id into me,g from private.telegram_links l join public.memberships m on m.id=l.membership_id
 where l.id=p_link and private.telegram_active(l.membership_id);
 if me is null then return null;end if;
 if p_from is null or p_until is null or not isfinite(p_from) or not isfinite(p_until)
 or p_from>=p_until or p_until-p_from>interval '366 days' then raise exception 'INVALID_PERIOD';end if;
 with attendance as (
  select a.mark from public.attendance a join public.events e on e.id=a.event_id and e.guild_id=a.guild_id
  where a.guild_id=g and a.membership_id=me and e.status='completed' and e.counts_for_attendance
  and e.attendance_finalized_at is not null and e.starts_at<=now() and e.starts_at>=p_from and e.starts_at<p_until
 ), awards as (
  select w.id,w.amount_units,a.created_at from public.treasury_awards w join public.treasury_allocations a on a.id=w.allocation_id and a.guild_id=w.guild_id
  where w.guild_id=g and w.membership_id=me and a.voided_at is null
 ), payouts as (
  select p.amount_units,p.created_at from public.treasury_payouts p join awards w on w.id=p.award_id where p.voided_at is null and p.guild_id=g
 ) select jsonb_build_object(
  'period_from',to_char(p_from,'YYYY-MM-DD'),'period_through',to_char(p_until-interval '1 day','YYYY-MM-DD'),
  'present',(select count(*) from attendance where mark='present'),
  'applicable',(select count(*) from attendance where mark in ('present','absent')),
  'percentage',round(100.0*(select count(*) from attendance where mark='present')/nullif((select count(*) from attendance where mark in ('present','absent')),0),1),
  'earned_units',(select coalesce(sum(amount_units),0)::text from awards where created_at>=p_from and created_at<p_until and created_at<=now()),
  'paid_units',(select coalesce(sum(amount_units),0)::text from payouts where created_at>=p_from and created_at<p_until and created_at<=now()),
  'pending_units',((select coalesce(sum(amount_units),0) from awards)-(select coalesce(sum(amount_units),0) from payouts))::text
 ) into result;
 return result;
end $$;
revoke all on function private.telegram_personal_stats(uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;

create or replace function public.receive_telegram_update(p_update bigint,p_telegram bigint,p_username text,p_command text,p_hash text default null,p_event uuid default null)
returns void language plpgsql security definer set search_path='' set timezone='UTC' as $$
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
 elsif p_command in ('stats_week','stats_month') then code:=p_command;
 elsif p_command='events' then code:='events';
 elsif p_command='cabinet' then code:='cabinet';
 end if;
 insert into private.telegram_outbox(dedupe,chat_id,link_id,kind,payload) values('update:'||p_update,p_telegram,linked,'reply',jsonb_build_object('code',code,'telegram_id',p_telegram::text,'event_id',case when code='signup_status' then p_event end,
  'period_from',case when code in ('stats_week','stats_month') then date_trunc(case when code='stats_week' then 'week' else 'month' end,now()) end,
  'period_until',case when code in ('stats_week','stats_month') then date_trunc('day',now())+interval '1 day' end));
end $$;

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
   if job.payload->>'code' in ('stats_week','stats_month') then
    body:=private.telegram_personal_stats(l.id,(job.payload->>'period_from')::timestamptz,(job.payload->>'period_until')::timestamptz);
    if body is not null then body:=body||jsonb_build_object('code',job.payload->>'code');end if;
   elsif job.payload->>'code'='events' then
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

commit;
