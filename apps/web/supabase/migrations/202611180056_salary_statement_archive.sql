begin;
create function public.salary_statement_report(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare g uuid;s public.salary_statements;
begin
 select id into g from public.guilds where slug='xd';
 if not public.has_permission(g,'treasury.allocate') then raise exception 'FORBIDDEN';end if;
 select * into s from public.salary_statements where id=p_id and guild_id=g;
 if s.id is null then raise exception 'NOT_FOUND';end if;
 return jsonb_build_object('id',s.id,'status',s.status,'created_at',s.created_at,'closed_at',s.closed_at,'reason',s.reason,'rows',s.snapshot->'rows',
 'creator',(select nickname from public.memberships where guild_id=g and user_id=s.created_by),
 'closer',(select nickname from public.memberships where guild_id=g and user_id=s.closed_by));
end $$;
revoke all on function public.salary_statement_report(uuid) from public,anon;
grant execute on function public.salary_statement_report(uuid) to authenticated;
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.salary_change_history(bigint)'::regprocedure);
 execute replace(definition,$old$'actor',coalesce(actor.nickname,'Система'),$old$,$new$'actor',coalesce(actor.nickname,'Система'),'statement_id',case when a.action in ('salary.statement_locked','salary.statement_completed','salary.statement_cancelled') then a.target_id end,$new$);
end $$;
notify pgrst,'reload schema';
commit;
