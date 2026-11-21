begin;
-- Record canonical before/after quotes once around each outer mutation, including bot imports.
create function private.record_salary_impact(g uuid,p_operation text,p_target uuid,p_before jsonb,p_after jsonb) returns void language plpgsql security definer set search_path='' as $$
declare changes jsonb;
begin
 with compared as (
 select b,a from jsonb_array_elements(p_before->'rows') b full join jsonb_array_elements(p_after->'rows') a on a->>'id'=b->>'id'
 )
 select coalesce(jsonb_agg(jsonb_build_object('member_id',coalesce(a->>'id',b->>'id'),'nickname',coalesce(a->>'nickname',b->>'nickname'),
 'prime_before',coalesce(((b->>'prime_projection')::numeric+(b->>'prime_fixed')::numeric)::text,'0'),
 'prime_after',coalesce(((a->>'prime_projection')::numeric+(a->>'prime_fixed')::numeric)::text,'0'),
 'mini_before',coalesce(((b->>'mini_projection')::numeric+(b->>'mini_fixed')::numeric)::text,'0'),
 'mini_after',coalesce(((a->>'mini_projection')::numeric+(a->>'mini_fixed')::numeric)::text,'0'),
 'prime_percent_before',b->'prime_percentage','prime_percent_after',a->'prime_percentage',
 'mini_percent_before',b->'mini_percentage','mini_percent_after',a->'mini_percentage') order by coalesce(a->>'id',b->>'id')),'[]') into changes
 from compared where (b->'prime_projection',b->'prime_fixed',b->'mini_projection',b->'mini_fixed',b->'prime_percentage',b->'mini_percentage',b->'prime_eligible',b->'mini_eligible') is distinct from (a->'prime_projection',a->'prime_fixed',a->'mini_projection',a->'mini_fixed',a->'prime_percentage',a->'mini_percentage',a->'prime_eligible',a->'mini_eligible');
 if jsonb_array_length(changes)>0 then
 insert into public.audit_log(guild_id,actor_id,action,target_id,detail) values(g,private.viewer_id(),'salary.calculation_changed',p_target,jsonb_build_object('operation',p_operation,'changes',changes,'deferred',exists(select 1 from public.salary_statements where guild_id=g and status='locked')));
 end if;
end $$;
revoke all on function private.record_salary_impact(uuid,text,uuid,jsonb,jsonb) from public,anon,authenticated;
do $migration$
declare p record;signature text;prior text;arguments text;params text;permission text;result_decl text;invoke text;finish text;definition text;
begin
 for p in select x.*,n.nspname from pg_proc x join pg_namespace n on n.oid=x.pronamespace where n.nspname='public' and x.proname in (
 'record_activity','save_activity_details','cancel_activity','delete_activity','change_event','edit_event','mark_attendance','review_participation_claim','archive_activities',
 'sell_treasury_loot','void_treasury_sale','sell_inventory_auction_now','sell_pending_auction_now','record_xd_service_sale','set_member_weight','set_guild_join_date') order by x.proname loop
 signature:=p.oid::regprocedure::text;
 prior:=p.proname||'_before_salary_history';
 arguments:=pg_get_function_arguments(p.oid);
 select string_agg('$'||i,',' order by i) into params from generate_series(1,p.pronargs) i;
 permission:=case when p.proname='set_member_weight' then 'members.coefficient' when p.proname='set_guild_join_date' then 'members.manage'
 when p.proname='archive_activities' then 'periods.close' when p.proname in ('mark_attendance','review_participation_claim') then 'attendance.manage'
 when p.proname like 'sell_%' or p.proname in ('void_treasury_sale','record_xd_service_sale') then 'treasury.manage' else 'events.manage' end;
 if p.prorettype='void'::regtype then result_decl:='';invoke:=format('perform public.%I(%s);',prior,params);finish:='return;';
 else result_decl:=format('response %s;',p.prorettype::regtype);invoke:=format('response:=public.%I(%s);',prior,params);finish:='return response;';end if;
 execute format('alter function %s rename to %I',signature,prior);
 execute format('revoke all on function public.%I(%s) from public,anon,authenticated',prior,pg_get_function_identity_arguments(p.oid));
 definition:=format($wrapper$
 create function public.%I(%s) returns %s language plpgsql security definer set search_path='' as $wrapped$
 declare g uuid;before_calc jsonb;depth text;%s
 begin
 depth:=current_setting('xd.salary_audit_depth',true);
 if depth='1' then %s %s end if;
 select id into g from public.guilds where slug='xd';
 perform private.lock_finance(g,%L);
 before_calc:=private.live_payroll_before_statements(g);
 perform set_config('xd.salary_audit_depth','1',true);
 %s
 perform set_config('xd.salary_audit_depth',coalesce(depth,'0'),true);
 perform private.record_salary_impact(g,%L,$1,before_calc,private.live_payroll_before_statements(g));
 %s
 end $wrapped$;
 $wrapper$,p.proname,arguments,p.prorettype::regtype,result_decl,invoke,finish,permission,invoke,p.proname,finish);
 execute definition;
 execute format('revoke all on function public.%I(%s) from public,anon',p.proname,pg_get_function_identity_arguments(p.oid));
 execute format('grant execute on function public.%I(%s) to authenticated',p.proname,pg_get_function_identity_arguments(p.oid));
 end loop;
 definition:=pg_get_functiondef('public.salary_change_history(bigint)'::regprocedure);
 definition:=replace(definition,
 $old$'reason',left(coalesce(a.detail->>'reason',''),500),$old$,
 $new$'reason',left(coalesce(a.detail->>'reason',''),500),'changes',a.detail->'changes','deferred',a.detail->'deferred','operation',a.detail->>'operation',$new$);
 execute definition;
end $migration$;
notify pgrst,'reload schema';
commit;
