begin;
create function public.finance_export(p_kind text,p_from timestamptz,p_until timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare g uuid;result jsonb;
begin
 select id into g from public.guilds where slug='xd';
 if not private.is_member(g) then raise exception 'FORBIDDEN';end if;
 if p_from is null or p_until is null or not isfinite(p_from) or not isfinite(p_until) or p_from>=p_until or p_until-p_from>interval '366 days' then raise exception 'INVALID_PERIOD';end if;
 if p_kind='awards' then
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into result from
   (select id,nickname_snapshot,event_title,created_at,amount_units,paid_units,pending_units,allocation_voided_at
    from public.treasury_award_accounts where guild_id=g and private.award_reader(g,membership_id)
    and created_at>=p_from and created_at<p_until order by created_at,id limit 5001) r;
 elsif p_kind='payouts' then
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into result from
   (select id,award_id,nickname_snapshot,created_at,amount_units,reference,voided_at,void_reason
    from public.treasury_payout_log where guild_id=g and private.award_reader(g,membership_id)
    and created_at>=p_from and created_at<p_until order by created_at,id limit 5001) r;
 else raise exception 'INVALID_EXPORT';end if;
 if jsonb_array_length(result)>5000 then raise exception 'EXPORT_TOO_LARGE';end if;
 return result;
end $$;
revoke all on function public.finance_export(text,timestamptz,timestamptz) from public,anon;
grant execute on function public.finance_export(text,timestamptz,timestamptz) to authenticated;
commit;
