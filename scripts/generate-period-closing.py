"""Generate migration extensions from the existing reviewed payroll allocator."""
from pathlib import Path
import subprocess
root=Path(__file__).resolve().parents[1]
base=(root/'apps/web/supabase/migrations/202611090028_period_payroll.sql').read_text()
payroll=base[base.index('create function private.period_payroll('):base.index('revoke all on function private.period_payroll(')]
payroll=payroll.replace('create function','create or replace function',1)
payroll=payroll.replace("points as (", "live_points as (")
start=payroll.index('), eligible as')
payroll=payroll[:start]+'''), points as (
 select * from live_points where not exists(select 1 from public.period_archives where guild_id=g and period_from=p_from)
 union all
 select r.id,r.nickname,r.payout_weight,r.status,r.available,r.present,r.prime_available,r.prime_present,r.mini_available,r.mini_present,r.pvp_available,r.pvp_present
 from public.period_archives a cross join lateral jsonb_to_recordset(a.snapshot->'points') r(id uuid,nickname text,payout_weight integer,status text,available numeric,present numeric,prime_available numeric,prime_present numeric,mini_available numeric,mini_present numeric,pvp_available numeric,pvp_present numeric)
 where a.guild_id=g and a.period_from=p_from
'''+payroll[start:]
payroll=payroll.replace("s.created_at>=p_from::timestamp at time zone 'UTC' and s.created_at<until_date::timestamp at time zone 'UTC'", "s.accounting_period=p_from")
payroll=payroll.replace("'sales',coalesce", "'points',coalesce((select jsonb_agg(to_jsonb(p)) from points p),'[]'), 'sales',coalesce")
pay=base[base.index('create function public.pay_period_member('):base.index('revoke all on function public.period_payroll_report(')]
materialize=pay[pay.index(' batch:=gen_random_uuid();'):pay.index(' for payout_award in')]
helper='''create function private.freeze_period_sales(g uuid,p_from date,calc jsonb) returns void language plpgsql security definer set search_path='' as $$
declare batch uuid; sale jsonb; member jsonb; allocation uuid;lo numeric;hi numeric;ml numeric;mh numeric;amount bigint;ids uuid[];src text; total numeric;
begin
'''+materialize+'''end $$;
revoke all on function private.freeze_period_sales(uuid,date,jsonb) from public,anon,authenticated;
'''
pay=pay.replace('create function','create or replace function',1)
pay=pay.replace(materialize," perform private.freeze_period_sales(g,p_from,calc);\n")
pay=pay.replace("s.created_at>=p_from::timestamp at time zone 'UTC' and s.created_at<(p_from+interval '1 month')::timestamp at time zone 'UTC'", "s.accounting_period=p_from")
prefix=(root/'scripts/period-closing-prefix.sql').read_text()
suffix=(root/'scripts/period-closing-suffix.sql').read_text()
journal=(root/'apps/web/supabase/migrations/202611090027_chest_inventory.sql').read_text()
journal=journal[journal.index('create or replace function public.activity_journal('):journal.rindex('commit;')]
journal=journal.replace("where e.guild_id=g and e.deleted_at is null and not e.inventory_receipt", "where e.guild_id=g and e.deleted_at is null and not e.inventory_receipt and not exists(select 1 from public.period_archives pa where pa.guild_id=e.guild_id and pa.period_from=private.period_start((e.starts_at at time zone 'UTC')::date))")
content=prefix+payroll+helper+pay+journal+suffix
target='apps/web/supabase/migrations/202611100032_period_closing.sql'
patch='*** Begin Patch\n*** Add File: '+str(root/target)+'\n'+''.join('+'+x+'\n' for x in content.splitlines())+'*** End Patch\n'
subprocess.run(['apply_patch',patch],check=True)
