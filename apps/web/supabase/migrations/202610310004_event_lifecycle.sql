begin;
alter table public.events add column version integer not null default 1;
create function public.change_event(p_id uuid,p_version integer,p_title text,p_description text,p_status text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare e public.events;g uuid;
begin
 select guild_id into g from public.events where id=p_id;
 if g is null then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.guilds where id=g for update;
 if not public.has_permission(g,'events.manage') then raise exception 'FORBIDDEN'; end if;
 select * into e from public.events where id=p_id for update;
 if e.version is distinct from p_version then raise exception 'STALE_VERSION'; end if;
 if e.status<>'scheduled' then raise exception 'EVENT_CLOSED'; end if;
 if p_status is null or p_status not in ('scheduled','completed','cancelled') then raise exception 'INVALID_STATUS'; end if;
 if p_status='completed' and e.starts_at>now() then raise exception 'EVENT_IN_FUTURE'; end if;
 if char_length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'REASON_REQUIRED'; end if;
 update public.events set title=btrim(p_title),description=btrim(p_description),status=p_status,version=version+1 where id=e.id;
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'event.changed',e.id,jsonb_build_object('before',to_jsonb(e),'after',(select to_jsonb(x) from public.events x where id=e.id),'reason',btrim(p_reason)));
end $$;
revoke all on function public.change_event(uuid,integer,text,text,text,text) from public,anon;
grant execute on function public.change_event(uuid,integer,text,text,text,text) to authenticated;
commit;
