begin;
create function public.salary_breakdown(p_member uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare g uuid;me uuid;calc jsonb;r jsonb;point jsonb;s public.salary_statements;joined date;activities jsonb;denominators jsonb;
begin
 select m.guild_id,m.id into g,me from public.memberships m join public.guilds x on x.id=m.guild_id and x.slug='xd' where m.user_id=private.viewer_id() and m.status='active';
 if g is null or not private.is_member(g) or (p_member is distinct from me and not public.has_permission(g,'members.read') and not private.finance_staff(g)) then raise exception 'FORBIDDEN';end if;
 calc:=private.lifetime_payroll(g);
 select v into r from jsonb_array_elements(calc->'rows') v where (v->>'id')::uuid=p_member;
 if r is null then raise exception 'NOT_FOUND';end if;
 select v into point from jsonb_array_elements(calc->'points') v where (v->>'id')::uuid=p_member;
 select * into s from public.salary_statements where guild_id=g and status='locked';
 if s.id is not null then
  joined:=(s.snapshot->'join_dates'->>p_member::text)::date;
  select coalesce(jsonb_agg(e||jsonb_build_object('present',exists(select 1 from jsonb_array_elements(s.snapshot->'marks') a where (a->>'member')::uuid=p_member and a->>'event'=e->>'id')) order by e->>'starts_at',e->>'id'),'[]') into activities
  from jsonb_array_elements(s.snapshot->'activities') e where joined is null or (e->>'starts_at')::timestamptz>=joined::timestamp at time zone 'UTC';
 else
  select guild_joined_on into joined from public.memberships where id=p_member and guild_id=g;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'starts_at',e.starts_at,'source',private.attendance_bucket(coalesce(nullif(e.activity_banner_name,''),e.title),e.kind),'weight',coalesce(e.activity_weight,100),'present',coalesce(a.mark='present',false)) order by e.starts_at,e.id),'[]') into activities
  from private.current_events e left join public.attendance a on a.event_id=e.id and a.membership_id=p_member and a.guild_id=g
  where e.guild_id=g and e.status='completed' and e.deleted_at is null and not e.inventory_receipt and e.counts_for_attendance and e.starts_at<=now()
  and (joined is null or e.starts_at>=joined::timestamp at time zone 'UTC');
 end if;
 select jsonb_build_object('prime',coalesce(sum((p->>'prime_present')::numeric*(p->>'payout_weight')::numeric/100) filter(where (row->>'prime_eligible')::boolean),0),
 'mini',coalesce(sum((p->>'mini_present')::numeric*(p->>'payout_weight')::numeric/100) filter(where (row->>'mini_eligible')::boolean),0)) into denominators
 from jsonb_array_elements(calc->'points') p join jsonb_array_elements(calc->'rows') row on row->>'id'=p->>'id';
 return jsonb_build_object('row',r,'statement',calc->'statement','guild_joined_on',joined,'activities',activities,'points',jsonb_build_object(
 'prime_present',point->'prime_present','prime_total',point->'prime_available','mini_present',point->'mini_present','mini_total',point->'mini_available'),
 'allocation_weights',denominators,'cash',jsonb_build_object('prime',private.fund_balance(g,'prime')::text,'mini',private.fund_balance(g,'mini_rb')::text));
end $$;

create function public.salary_change_history(p_before bigint default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare g uuid;entries jsonb;
begin
 select id into g from public.guilds where slug='xd';
 if not public.has_permission(g,'treasury.allocate') then raise exception 'FORBIDDEN';end if;
 with recent as (
 select a.* from public.audit_log a where a.guild_id=g and (p_before is null or a.id<p_before) and
 (a.action like 'salary.%' or a.action in ('member.guild_join_date','member.coefficient','attendance.changed','activity.report_saved','activity.created','activity.deleted','activities.archived','event.changed','event.edited','event.created','treasury.sold','treasury.sale_voided','treasury.payout','treasury.payout_voided','treasury.service_sold','treasury.xd_service_sold'))
 order by a.id desc limit 50
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id::text,'at',a.created_at,'action',a.action,'target_id',a.target_id,
 'actor',coalesce(actor.nickname,'Система'),'target',coalesce(member.nickname,e.title),
 'reason',left(coalesce(a.detail->>'reason',''),500),
 'source',coalesce(a.detail->>'source',a.detail->'sale'->>'source'),
 'amount_units',coalesce(a.detail->>'amount_units',a.detail->>'gross_units',a.detail->'sale'->>'gross_units'),
 'before',case when a.action in ('member.guild_join_date','member.coefficient') then a.detail->'before' else null end,
 'after',case when a.action in ('member.guild_join_date','member.coefficient') then a.detail->'after' else null end,
 'coefficient',coalesce(a.detail->'coefficient',a.detail->'after'->'activity_weight'),
 'previous_coefficient',coalesce(a.detail->'previous_event'->'weight',a.detail->'before'->'activity_weight')) order by a.id desc),'[]') into entries
 from recent a left join public.memberships actor on actor.user_id=a.actor_id and actor.guild_id=g
 left join public.memberships member on member.id=a.target_id and member.guild_id=g left join public.events e on e.id=a.target_id and e.guild_id=g;
 return jsonb_build_object('entries',entries,'next_before',case when jsonb_array_length(entries)=50 then entries->49->>'id' end);
end $$;
revoke all on function public.salary_breakdown(uuid),public.salary_change_history(bigint) from public,anon;
grant execute on function public.salary_breakdown(uuid),public.salary_change_history(bigint) to authenticated;
notify pgrst,'reload schema';
commit;
