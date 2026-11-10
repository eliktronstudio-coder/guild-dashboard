begin;
-- Keep report metadata and immutable evidence references in each future snapshot.
-- Images retain their existing attendance/loot access controls in the evidence table.
do $$
declare definition text;needle text:='to_jsonb(e)||jsonb_build_object(''roster''';replacement text;
begin
 definition:=pg_get_functiondef('public.close_payroll_period(date,text)'::regprocedure);
 replacement:='to_jsonb(e)||jsonb_build_object(''report'',coalesce((select to_jsonb(ar)-''request_hash'' from public.activity_reports ar where ar.event_id=e.id),''{}''),''evidence'',coalesce((select jsonb_agg(jsonb_build_object(''id'',v.id,''kind'',v.kind,''created_at'',v.created_at) order by v.id) from public.activity_evidence v where v.event_id=e.id),''[]''),''roster''';
 if position(needle in definition)=0 then raise exception 'CLOSING_DEFINITION_MISMATCH'; end if;
 execute replace(definition,needle,replacement);
end $$;
create trigger closed_activity_report before insert or update or delete on public.activity_reports for each row execute function private.guard_closed_event();
create trigger closed_activity_evidence before insert or update or delete on public.activity_evidence for each row execute function private.guard_closed_event();
commit;
