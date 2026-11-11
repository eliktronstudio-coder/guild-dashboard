begin;
alter table public.memberships drop constraint memberships_player_class_check;
alter table public.memberships add constraint memberships_player_class_check check(player_class in ('Лучник','Маг','Милик','Танк','Хил'));
alter table private.email_registrations drop constraint email_registrations_player_class_check;
alter table private.email_registrations add constraint email_registrations_player_class_check check(player_class in ('Лучник','Маг','Милик','Танк','Хил'));
do $$
declare signature text;definition text;old_values text:='(''Лучник'',''Маг'',''Милик'',''Танк'')';new_values text:='(''Лучник'',''Маг'',''Милик'',''Танк'',''Хил'')';
begin
 foreach signature in array array['private.capture_email_registration()','public.complete_open_registration(text,text,boolean,boolean,text)','public.set_own_player_class(text)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if position(old_values in definition)=0 then raise exception 'PLAYER_CLASS_ENUM_DEFINITION_MISMATCH';end if;
  execute replace(definition,old_values,new_values);
 end loop;
end $$;
commit;
