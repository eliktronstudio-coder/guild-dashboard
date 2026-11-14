begin;
insert into public.permissions(key) values('telegram.manage');
insert into public.role_permissions(role_id,permission) select id,'telegram.manage' from public.roles where code in ('owner','admin');
create table private.telegram_links (
 id uuid primary key default gen_random_uuid(),membership_id uuid not null unique references public.memberships(id),
 telegram_id bigint not null unique check(telegram_id between 1 and 9007199254740991),
 username text,notifications boolean not null default false,created_at timestamptz not null default now()
);
create table private.telegram_requests (
 id uuid primary key default gen_random_uuid(),membership_id uuid not null unique references public.memberships(id),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 telegram_id bigint check(telegram_id between 1 and 9007199254740991),username text,
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '10 minutes'
);
create table private.telegram_updates(update_id bigint primary key,telegram_id bigint not null,created_at timestamptz not null default now());
create index telegram_updates_sender on private.telegram_updates(telegram_id,created_at);
create table private.telegram_outbox (
 id uuid primary key default gen_random_uuid(),dedupe text not null unique,chat_id bigint not null,
 link_id uuid,kind text not null check(kind in ('reply','event','award','award_cancelled')),payload jsonb not null,
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','cancelled')),
 attempts integer not null default 0,available_at timestamptz not null default now(),
 lease uuid,lease_until timestamptz,sent_at timestamptz,attempted_at timestamptz,error_code text,
 created_at timestamptz not null default now()
);
create index telegram_outbox_ready on private.telegram_outbox(status,available_at,created_at);
create index telegram_outbox_chat on private.telegram_outbox(chat_id,sent_at);
alter table private.telegram_links enable row level security;
alter table private.telegram_requests enable row level security;
alter table private.telegram_updates enable row level security;
alter table private.telegram_outbox enable row level security;
revoke all on private.telegram_links,private.telegram_requests,private.telegram_updates,private.telegram_outbox from public,anon,authenticated;

create function private.telegram_member() returns uuid language plpgsql stable security definer set search_path='' as $$
declare m uuid;
begin
 select id into m from public.memberships where user_id=private.viewer_id() and status='active' and guild_id=(select id from public.guilds where slug='xd');
 if m is null then raise exception 'FORBIDDEN'; end if;return m;
end $$;
create function private.telegram_active(p_member uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships m join public.profiles p on p.id=m.user_id join public.guilds g on g.id=m.guild_id
 where m.id=p_member and m.status='active' and not p.blocked and g.slug='xd')
$$;
create function public.telegram_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m uuid:=private.telegram_member();
begin
 return jsonb_build_object('link',(select jsonb_build_object('id',id,'telegram_id',telegram_id::text,'username',username,'notifications',notifications) from private.telegram_links where membership_id=m),
 'request',(select jsonb_build_object('id',id,'telegram_id',telegram_id::text,'username',username,'expires_at',expires_at) from private.telegram_requests where membership_id=m and expires_at>now()));
end $$;
create function public.begin_telegram_link(p_hash text) returns void language plpgsql security definer set search_path='' as $$
declare m uuid:=private.telegram_member();
begin
 perform 1 from public.memberships where id=m for update;
 if exists(select 1 from private.telegram_links where membership_id=m) then raise exception 'ALREADY_LINKED'; end if;
 if exists(select 1 from private.telegram_requests where membership_id=m and created_at>now()-interval '30 seconds') then raise exception 'RATE_LIMIT';end if;
 delete from private.telegram_requests where membership_id=m;
 insert into private.telegram_requests(membership_id,token_hash) values(m,p_hash);
end $$;
create function public.confirm_telegram_link(p_request uuid,p_telegram_id bigint,p_notifications boolean) returns void language plpgsql security definer set search_path='' as $$
declare m uuid:=private.telegram_member();r private.telegram_requests;
begin
 perform 1 from public.memberships where id=m for update;
 select * into r from private.telegram_requests where id=p_request and membership_id=m for update;
 if not found or r.expires_at<=now() or r.telegram_id is null or p_telegram_id is null or r.telegram_id<>p_telegram_id then raise exception 'LINK_EXPIRED';end if;
 if exists(select 1 from private.telegram_links where telegram_id=r.telegram_id or membership_id=m) then raise exception 'ALREADY_LINKED';end if;
 insert into private.telegram_links(membership_id,telegram_id,username,notifications) values(m,r.telegram_id,r.username,coalesce(p_notifications,false));
 delete from private.telegram_requests where id=r.id;
 insert into public.audit_log(guild_id,actor_id,action,target_id) select guild_id,private.viewer_id(),'telegram.linked',m from public.memberships where id=m;
end $$;
create function public.set_telegram_notifications(p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$
declare m uuid:=private.telegram_member();
begin
 update private.telegram_links set notifications=coalesce(p_enabled,false) where membership_id=m;
 if not found then raise exception 'NOT_LINKED';end if;
 if not coalesce(p_enabled,false) then update private.telegram_outbox set status='cancelled' where link_id in(select id from private.telegram_links where membership_id=m) and kind<>'reply' and status='pending';end if;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) select guild_id,private.viewer_id(),'telegram.preferences',m,jsonb_build_object('enabled',coalesce(p_enabled,false)) from public.memberships where id=m;
end $$;
create function public.unlink_telegram() returns void language plpgsql security definer set search_path='' as $$
declare m uuid:=private.telegram_member();
begin
 perform 1 from public.memberships where id=m for update;
 update private.telegram_outbox set status='cancelled' where link_id in(select id from private.telegram_links where membership_id=m) and status='pending';
 delete from private.telegram_links where membership_id=m;
 delete from private.telegram_requests where membership_id=m;
 insert into public.audit_log(guild_id,actor_id,action,target_id) select guild_id,private.viewer_id(),'telegram.unlinked',m from public.memberships where id=m;
end $$;

-- Only the trusted webhook service can submit Telegram updates; never an authenticated browser.
create function public.receive_telegram_update(p_update bigint,p_telegram bigint,p_username text,p_command text,p_hash text default null)
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
 elsif p_command='events' then code:='events';
 elsif p_command='cabinet' then code:='cabinet';
 end if;
 insert into private.telegram_outbox(dedupe,chat_id,link_id,kind,payload) values('update:'||p_update,p_telegram,linked,'reply',jsonb_build_object('code',code,'telegram_id',p_telegram::text));
end $$;

-- Notification jobs are created in the same transaction as the event or allocation.
create function private.queue_telegram_event() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if (new.title,new.starts_at,new.status) is not distinct from (old.title,old.starts_at,old.status) then return new;end if;
 elsif new.status<>'scheduled' or new.starts_at<=now() then return new;
 end if;
 insert into private.telegram_outbox(dedupe,chat_id,link_id,kind,payload)
 select 'event:'||new.id||':'||new.version||':'||l.id,l.telegram_id,l.id,'event',jsonb_build_object('event_id',new.id)
 from private.telegram_links l join public.memberships m on m.id=l.membership_id
 where m.guild_id=new.guild_id and l.notifications and private.telegram_active(m.id) on conflict(dedupe) do nothing;
 return new;
end $$;
create trigger telegram_event after insert or update on public.events for each row execute function private.queue_telegram_event();
create function private.queue_telegram_award() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into private.telegram_outbox(dedupe,chat_id,link_id,kind,payload)
 select 'award:'||new.id||':'||l.id,l.telegram_id,l.id,'award',jsonb_build_object('award_id',new.id)
 from private.telegram_links l where l.membership_id=new.membership_id and l.notifications and private.telegram_active(l.membership_id) on conflict(dedupe) do nothing;
 return new;
end $$;
create trigger telegram_award after insert on public.treasury_awards for each row execute function private.queue_telegram_award();
create function private.queue_telegram_award_cancelled() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.voided_at is null and new.voided_at is not null then
  insert into private.telegram_outbox(dedupe,chat_id,link_id,kind,payload)
  select 'award_cancelled:'||w.id||':'||l.id,l.telegram_id,l.id,'award_cancelled',jsonb_build_object('award_id',w.id)
  from public.treasury_awards w join private.telegram_links l on l.membership_id=w.membership_id
  where w.allocation_id=new.id and l.notifications and private.telegram_active(l.membership_id) on conflict(dedupe) do nothing;
 end if;return new;
end $$;
create trigger telegram_award_cancelled after update on public.treasury_allocations for each row execute function private.queue_telegram_award_cancelled();

create function public.claim_telegram_delivery() returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare job private.telegram_outbox;l private.telegram_links;body jsonb;event public.events;amount text;is_void boolean;owner uuid;token uuid;
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
      (select e.id,e.title,e.starts_at from public.events e join public.memberships m on m.guild_id=e.guild_id where m.id=l.membership_id and e.status='scheduled' and e.starts_at>now() order by starts_at,id limit 5) e),'[]'::jsonb));
    end if;
   end if;
  elsif job.kind='event' then
   select e.* into event from public.events e join public.memberships m on m.guild_id=e.guild_id where e.id=(job.payload->>'event_id')::uuid and m.id=l.membership_id;
   if found then body:=jsonb_build_object('code','event','id',event.id,'title',event.title,'starts_at',event.starts_at,'status',event.status);end if;
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
create function public.finish_telegram_delivery(p_id uuid,p_lease uuid,p_result text,p_retry integer default 10) returns boolean language plpgsql security definer set search_path='' as $$
declare j private.telegram_outbox;
begin
 select * into j from private.telegram_outbox where id=p_id and lease=p_lease and status='sending' for update;
 if not found then return false;end if;
 if p_result is null or p_result not in ('sent','retry','blocked','failed') then raise exception 'INVALID_RESULT';end if;
 update private.telegram_outbox set status=case when p_result='sent' then 'sent' when p_result='retry' and attempts<5 then 'pending' else 'failed' end,
 sent_at=case when p_result='sent' then now() else sent_at end,error_code=case when p_result='sent' then null else p_result end,
 available_at=now()+make_interval(secs=>greatest(1,least(coalesce(p_retry,10),3600))),lease=null,lease_until=null where id=j.id;
 if p_result='blocked' then update private.telegram_links set notifications=false where id=j.link_id;end if;
 return true;
end $$;
create function public.telegram_delivery_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare g uuid;
begin
 select id into g from public.guilds where slug='xd';if not public.has_permission(g,'telegram.manage') then raise exception 'FORBIDDEN';end if;
 return jsonb_build_object('pending',(select count(*) from private.telegram_outbox where status in ('pending','sending')),
 'failed',(select count(*) from private.telegram_outbox where status='failed'),
 'sent',(select count(*) from private.telegram_outbox where status='sent'),
 'subscribers',(select count(*) from private.telegram_links where notifications and private.telegram_active(membership_id)));
end $$;
create function public.retry_telegram_failures() returns integer language plpgsql security definer set search_path='' as $$
declare g uuid;updated integer;
begin
 select id into g from public.guilds where slug='xd';if not public.has_permission(g,'telegram.manage') then raise exception 'FORBIDDEN';end if;
 update private.telegram_outbox set status='pending',attempts=0,available_at=now(),lease=null,lease_until=null
 where status='failed' and created_at>now()-interval '1 day';
 get diagnostics updated=row_count;
 insert into public.audit_log(guild_id,actor_id,action,detail) values(g,private.viewer_id(),'telegram.retried',jsonb_build_object('count',updated));
 return updated;
end $$;
revoke all on function private.telegram_member(),private.telegram_active(uuid),private.queue_telegram_event(),private.queue_telegram_award(),private.queue_telegram_award_cancelled() from public,anon,authenticated;
revoke all on function public.telegram_status(),public.begin_telegram_link(text),public.confirm_telegram_link(uuid,bigint,boolean),public.set_telegram_notifications(boolean),public.unlink_telegram(),public.telegram_delivery_status(),public.retry_telegram_failures() from public,anon;
grant execute on function public.telegram_status(),public.begin_telegram_link(text),public.confirm_telegram_link(uuid,bigint,boolean),public.set_telegram_notifications(boolean),public.unlink_telegram(),public.telegram_delivery_status(),public.retry_telegram_failures() to authenticated;
revoke all on function public.receive_telegram_update(bigint,bigint,text,text,text),public.claim_telegram_delivery(),public.finish_telegram_delivery(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.receive_telegram_update(bigint,bigint,text,text,text),public.claim_telegram_delivery(),public.finish_telegram_delivery(uuid,uuid,text,integer) to service_role;
commit;
