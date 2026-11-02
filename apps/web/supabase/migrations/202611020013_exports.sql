begin;
create function public.guild_export(p_kind text,p_from timestamptz default null,p_until timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare g uuid;result jsonb;
begin
 select id into g from public.guilds where slug='xd';
 if not private.is_member(g) then raise exception 'FORBIDDEN';end if;
 if p_kind='members' then
  if not public.has_permission(g,'members.read') then raise exception 'FORBIDDEN';end if;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into result from
   (select nickname,joined_at,main_character,character_class,specialization,game_server,role_names
    from public.member_directory where guild_id=g and status='active' order by nickname,id limit 5001) r;
 elsif p_kind='attendance' then
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into result from
   (select nickname,present,absent,excused,excluded,percentage from public.attendance_report(p_from,p_until)
    order by nickname,membership_id limit 5001) r;
 else raise exception 'INVALID_EXPORT';end if;
 if jsonb_array_length(result)>5000 then raise exception 'EXPORT_TOO_LARGE';end if;
 return result;
end $$;
revoke all on function public.guild_export(text,timestamptz,timestamptz) from public,anon;
grant execute on function public.guild_export(text,timestamptz,timestamptz) to authenticated;
commit;
