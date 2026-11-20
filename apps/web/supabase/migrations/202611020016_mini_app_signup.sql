begin;
create table private.mini_app_signup_requests(
 link_id uuid not null references private.telegram_links(id) on delete cascade,
 request_id uuid not null,event_id uuid not null,joined boolean not null,created_at timestamptz not null default now(),primary key(link_id,request_id)
);
alter table private.mini_app_signup_requests enable row level security;
revoke all on private.mini_app_signup_requests from public,anon,authenticated,service_role;
create function public.telegram_mini_app_signup(p_telegram bigint,p_event uuid,p_join boolean,p_request uuid,p_auth_date bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare report jsonb;l private.telegram_links;old private.mini_app_signup_requests;
begin
 if p_request is null or p_event is null or p_join is null then raise exception 'INVALID_INPUT';end if;
 report:=public.telegram_mini_app_report(p_telegram,'month');
 if report ? 'error' then return report;end if;
 select * into l from private.telegram_links where telegram_id=p_telegram;
 -- Wait first, then check signed launch age and current binding in the common handler.
 perform 1 from public.events where id=p_event for update;
 if p_auth_date is null or p_auth_date<extract(epoch from clock_timestamp())-300 or p_auth_date>extract(epoch from clock_timestamp())+30 then return jsonb_build_object('error','expired');end if;
 select * into old from private.mini_app_signup_requests where link_id=l.id and request_id=p_request;
 if found then
  if old.event_id<>p_event or old.joined<>p_join then return jsonb_build_object('error','invalid_request');end if;
  return jsonb_build_object('ok',true);
 end if;
 begin
  perform private.set_member_event_signup(p_event,l.membership_id,p_join,'telegram',l.id);
 exception when raise_exception then
  if sqlerrm in ('FORBIDDEN','EVENT_CLOSED','INVALID_INPUT') then return jsonb_build_object('error','event_unavailable');else raise;end if;
 end;
 insert into private.mini_app_signup_requests(link_id,request_id,event_id,joined) values(l.id,p_request,p_event,p_join);
 delete from private.mini_app_signup_requests where created_at<now()-interval '1 day';
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.telegram_mini_app_signup(bigint,uuid,boolean,uuid,bigint) from public,anon,authenticated;
grant execute on function public.telegram_mini_app_signup(bigint,uuid,boolean,uuid,bigint) to service_role;
commit;
