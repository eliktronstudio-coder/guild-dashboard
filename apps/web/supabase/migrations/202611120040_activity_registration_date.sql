begin;
-- Website registration time does not determine whether a player attended an
-- earlier raid. Add explicitly selected current members to the event snapshot
-- before applying marks. Do not backfill absences for uninvolved new accounts.
do $$
declare definition text;
 guard text:='m.status=''active'' and m.joined_at<=e.starts_at';
 anchor text:='if e.status=''completed'' then'||chr(10)||'   for a in select';
 replacement text:='if e.status=''completed'' then'||chr(10)||
 '   insert into public.attendance(guild_id,event_id,membership_id,mark)'||chr(10)||
 '   select e.guild_id,e.id,x,''absent'' from unnest(selected) x on conflict do nothing;'||chr(10)||
 '   for a in select';
begin
 definition:=pg_get_functiondef('private.apply_activity_details(uuid,jsonb,text)'::regprocedure);
 if position(guard in definition)=0 or position(anchor in definition)=0 then raise exception 'ACTIVITY_REGISTRATION_DATE_DEFINITION_MISMATCH';end if;
 definition:=replace(definition,guard,'m.status=''active''');
 execute replace(definition,anchor,replacement);
end $$;
commit;
