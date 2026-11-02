"""Disposable PostgreSQL concurrency verification. Requires local Docker + postgres:17-bookworm.
No production connection, published port, credentials or user data are used.
"""
from pathlib import Path
from subprocess import run, Popen, PIPE
import json
import os
import time
import uuid
import sys

ROOT = Path(__file__).resolve().parents[1]
ENV = os.environ.copy()
for key in ("DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"):
    ENV.pop(key, None)
DOCKER = ["docker", "--host=unix:///var/run/docker.sock"]
NAME = "xd-treasury-check-" + uuid.uuid4().hex[:10]
GUILD = "00000000-0000-4000-8000-000000000001"
USER = "10000000-0000-4000-8000-000000000001"
SESSION = "20000000-0000-4000-8000-000000000001"
MEMBER = "30000000-0000-4000-8000-000000000001"

def docker(*args, **kwargs):
    return run(DOCKER + list(args), env=ENV, text=True, capture_output=True, **kwargs)

def sql(text, check=True):
    result = docker("exec", "-i", NAME, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", input=text, timeout=20)
    if check and result.returncode:
        raise AssertionError(result.stderr)
    return result

def scalar(text):
    return sql(text).stdout.strip().splitlines()[-1]

def auth(user=USER, session=SESSION):
    claims = json.dumps({"sub": user, "session_id": session})
    return f"set role authenticated; set request.jwt.claims = '{claims}';"

def held(statement, identity=True):
    # Marker is emitted after mutation acquired transaction locks, before commit.
    process = Popen(DOCKER + ["exec", "-i", NAME, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres"], env=ENV, stdin=PIPE, stdout=PIPE, stderr=PIPE, text=True)
    process.stdin.write("begin;" + (auth() if identity else "") + statement + "\n\\echo XD_LOCK_HELD\nselect pg_sleep(1.5); commit;\n")
    process.stdin.close()
    while True:
        line = process.stdout.readline()
        if "XD_LOCK_HELD" in line:
            return process
        if not line:
            raise AssertionError(process.stderr.read())

def finish(process):
    process.wait(timeout=15)
    assert process.returncode == 0, process.stderr.read()

def event():
    e = str(uuid.uuid4())
    sql(f"insert into public.events(id,guild_id,title,kind,starts_at,organizer_id,status,treasury_source) values('{e}','{GUILD}','Тестовая активность','raid',now()-interval '1 day','{MEMBER}','completed','prime');")
    return e

def add(e, quantity=1):
    loot = str(uuid.uuid4())
    statement = f"select public.add_treasury_loot('{loot}','{e}','Тестовый дроп','Материалы',{quantity},10000,'');"
    sql(auth() + statement)
    return loot

def sale(loot, request, version=1):
    return f"select public.sell_treasury_loot('{request}','{loot}',{version},1,1000000000,'');"

def verify(loot, remaining, sales):
    assert scalar(f"select quantity_remaining from public.treasury_loot where id='{loot}';") == str(remaining)
    assert scalar(f"select count(*) from public.treasury_sales where loot_id='{loot}' and voided_at is null;") == str(sales)

started = False
try:
    result = docker("run", "--rm", "-d", "--network", "none", "--name", NAME, "--tmpfs", "/var/lib/postgresql/data", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-bookworm", timeout=40)
    assert result.returncode == 0, result.stderr
    started = True
    for _ in range(50):
        if docker("exec", NAME, "cat", "/proc/1/comm", timeout=2).stdout.strip() == "postgres" and docker("exec", NAME, "pg_isready", "-U", "postgres", timeout=2).returncode == 0:
            break
        time.sleep(0.2)
    else:
        raise AssertionError("Temporary PostgreSQL did not become ready")
    sql("""create role anon; create role authenticated; create role service_role; create schema auth;
create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users);
create table auth.identities(user_id uuid references auth.users,provider text);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
grant usage on schema auth to authenticated,anon;
grant execute on function auth.jwt(),auth.uid() to authenticated,anon;""")
    for migration in sorted((ROOT / "supabase/migrations").glob("*.sql")):
        sql(migration.read_text())
    sql(f"insert into auth.users values('{USER}',now()); insert into auth.sessions values('{SESSION}','{USER}'); select private.bootstrap_owner('{USER}','Владелец');")
    MEMBER = scalar(f"select id from public.memberships where user_id='{USER}';")
    loot = add(event())
    first = held(sale(loot, str(uuid.uuid4())))
    second = sql(auth() + sale(loot, str(uuid.uuid4())), check=False)
    finish(first)
    assert second.returncode != 0 and "STALE_VERSION" in second.stderr
    verify(loot, 0, 1)
    print("PASS: two connections cannot sell the last item twice", flush=True)

    loot = add(event()); request = str(uuid.uuid4())
    first = held(sale(loot, request))
    second = sql(auth() + sale(loot, request))
    finish(first); verify(loot, 0, 1)
    assert scalar(f"select guild_units||','||fund_units from public.treasury_sales where id='{request}';") == "300000000,700000000"
    print("PASS: concurrent identical requests create exactly one 70/30 allocation", flush=True)

    statement = f"select public.void_treasury_sale('{request}','Отмена тестовой продажи');"
    first = held(statement); sql(auth() + statement); finish(first); verify(loot, 1, 0)
    print("PASS: concurrent voids restore inventory and allocations exactly once", flush=True)

    e = event(); loot = str(uuid.uuid4())
    first = held(f"select public.add_treasury_loot('{loot}','{e}','Тестовый дроп','',1,10000,'');")
    second = sql(auth() + f"select public.tag_event_treasury('{e}',1,'mini_rb','Попытка переноса');", check=False)
    finish(first)
    assert second.returncode != 0 and "SOURCE_LOCKED" in second.stderr
    print("PASS: tag cannot change while first loot is being registered", flush=True)

    treasurer = str(uuid.uuid4()); session = str(uuid.uuid4())
    sql(f"insert into auth.users values('{treasurer}',now()); insert into auth.sessions values('{session}','{treasurer}'); insert into public.memberships(guild_id,user_id,nickname) values('{GUILD}','{treasurer}','Казначей'); insert into public.membership_roles select m.guild_id,m.id,r.id from public.memberships m join public.roles r on r.guild_id=m.guild_id and r.code='treasurer' where m.user_id='{treasurer}';")
    loot = add(event())
    first = held(f"select 1 from public.guilds where id='{GUILD}' for update; delete from public.membership_roles where membership_id in (select id from public.memberships where user_id='{treasurer}');", identity=False)
    second = sql(auth(treasurer, session) + sale(loot, str(uuid.uuid4())), check=False)
    finish(first)
    assert second.returncode != 0 and "FORBIDDEN" in second.stderr
    verify(loot, 1, 0)
    print("PASS: permission revoked during lock wait prevents sale", flush=True)
    e = event(); loot = add(e); request = str(uuid.uuid4())
    sql(auth() + sale(loot, request))
    sql(f"insert into public.attendance(guild_id,event_id,membership_id,mark) values('{GUILD}','{e}','{MEMBER}','present');")
    sql(auth()+f"select public.finalize_attendance('{e}',1);")
    allocation = str(uuid.uuid4())
    allocate = f"select public.allocate_treasury_sale('{allocation}','{request}',array['{MEMBER}'::uuid],'Подтверждённая явка');"
    first = held(allocate); sql(auth()+allocate); finish(first)
    assert scalar(f"select count(*) from public.treasury_awards where allocation_id='{allocation}';") == '1'
    second = sql(auth()+f"select public.allocate_treasury_sale('{uuid.uuid4()}','{request}',array['{MEMBER}'::uuid],'Повторное начисление');",check=False)
    assert second.returncode and 'ALREADY_ALLOCATED' in second.stderr
    print('PASS: concurrent allocation retry creates one award',flush=True)
    award = scalar(f"select id from public.treasury_awards where allocation_id='{allocation}';")
    payout = str(uuid.uuid4())
    pay = f"select public.pay_treasury_award('{payout}','{award}',1,700000000,'Передано в игре');"
    first = held(pay)
    second = sql(auth()+f"select public.pay_treasury_award('{uuid.uuid4()}','{award}',1,700000000,'Вторая выплата');",check=False)
    finish(first)
    assert second.returncode and 'STALE_VERSION' in second.stderr
    sql(auth()+pay)
    assert scalar(f"select sum(amount_units) from public.treasury_payouts where award_id='{award}' and voided_at is null;")=='700000000'
    print('PASS: competing payouts cannot pay one obligation twice',flush=True)
    cancel = f"select public.void_treasury_payout('{payout}','Исправление ошибочной записи');"
    first = held(cancel); sql(auth()+cancel); finish(first)
    assert scalar(f"select count(*) from public.treasury_payouts where award_id='{award}' and voided_at is null;")=='0'
    print('PASS: concurrent payout cancellations restore debt once',flush=True)
    available = scalar(auth()+"select public.treasury_summary()->>'guild_units';")
    expense = str(uuid.uuid4())
    spend = f"select public.record_treasury_expense('{expense}',{available},'Расход гильдии');"
    first = held(spend)
    second = sql(auth()+f"select public.record_treasury_expense('{uuid.uuid4()}',1,'Лишний расход');",check=False)
    finish(first)
    assert second.returncode and 'INSUFFICIENT_FUNDS' in second.stderr
    assert scalar(auth()+"select public.treasury_summary()->>'guild_units';")=='0'
    print('PASS: concurrent expenses cannot overspend guild cash',flush=True)


    # Two independent database sessions exercise Telegram deduplication and worker leases.
    command = "set role service_role; select public.receive_telegram_update(1001,123456,null,'help',null);"
    first = held(command, identity=False); sql(command); finish(first)
    assert scalar("select count(*) from private.telegram_outbox where dedupe='update:1001';") == '1'
    print('PASS: concurrent Telegram update retries enqueue one reply', flush=True)
    claim = "set role service_role; select public.claim_telegram_delivery();"
    first = held(claim, identity=False)
    second = sql(claim)
    finish(first)
    assert not second.stdout.strip()
    assert scalar("select count(*) from private.telegram_outbox where status='sending';") == '1'
    print('PASS: concurrent Telegram workers cannot claim a second in-flight delivery', flush=True)

    other_member = scalar(f"select id from public.memberships where user_id='{treasurer}';")
    first_request, second_request = str(uuid.uuid4()), str(uuid.uuid4())
    sql(f"insert into private.telegram_requests(id,membership_id,token_hash,telegram_id) values('{first_request}','{MEMBER}',repeat('a',64),123456789),('{second_request}','{other_member}',repeat('b',64),123456789);")
    first = held(f"select public.confirm_telegram_link('{first_request}',123456789,false);")
    second = sql(auth(treasurer,session)+f"select public.confirm_telegram_link('{second_request}',123456789,false);",check=False)
    finish(first)
    assert second.returncode != 0
    assert scalar("select count(*) from private.telegram_links where telegram_id=123456789;") == '1'
    assert scalar(f"select membership_id from private.telegram_links where telegram_id=123456789;") == MEMBER
    print('PASS: two website confirmations cannot bind one Telegram ID to two members', flush=True)

    def future_event():
        event_id = str(uuid.uuid4())
        sql(f"insert into public.events(id,guild_id,title,kind,starts_at,organizer_id) values('{event_id}','{GUILD}','Будущий рейд','raid',now()+interval '1 day','{MEMBER}');")
        return event_id
    e = future_event()
    first = held(f"select public.set_event_signup('{e}',true);")
    sql(f"set role service_role;select public.receive_telegram_update(2001,123456789,null,'join',null,'{e}');")
    finish(first)
    assert scalar(f"select count(*) from public.event_signups where event_id='{e}' and membership_id='{MEMBER}';") == '1'
    assert scalar(f"select count(*) from public.audit_log where action='event.signup_changed' and target_id='{e}';") == '1'
    print('PASS: website and bot concurrently create one signup and one audit record',flush=True)
    e = future_event()
    first = held(f"select public.change_event('{e}',1,'Будущий рейд','','cancelled','Отмена рейда');")
    sql(f"set role service_role;select public.receive_telegram_update(2002,123456789,null,'join',null,'{e}');")
    finish(first)
    assert scalar(f"select count(*) from public.event_signups where event_id='{e}';") == '0'
    assert scalar("select payload->>'code' from private.telegram_outbox where dedupe='update:2002';") == 'event_unavailable'
    print('PASS: event cancellation while bot waits for lock prevents signup',flush=True)
    e = future_event()
    first = held(f"select 1 from public.events where id='{e}' for update;delete from private.telegram_links where membership_id='{MEMBER}';",identity=False)
    sql(f"set role service_role;select public.receive_telegram_update(2003,123456789,null,'join',null,'{e}');")
    finish(first)
    assert scalar(f"select count(*) from public.event_signups where event_id='{e}';") == '0'
    print('PASS: unlinking while bot waits prevents use of the old binding',flush=True)

    e = future_event()
    first = held(f"select 1 from public.events where id='{e}' for update;insert into public.revoked_sessions(session_id,user_id) values('{SESSION}','{USER}');",identity=False)
    second = sql(auth()+f"select public.set_event_signup('{e}',true);",check=False)
    finish(first)
    assert second.returncode != 0 and 'FORBIDDEN' in second.stderr
    assert scalar(f"select count(*) from public.event_signups where event_id='{e}';") == '0'
    print('PASS: website session revoked during lock wait cannot create a signup',flush=True)


    # The Mini App never needs a web session: signed Telegram identity is bound separately.
    sql(f"insert into private.telegram_links(membership_id,telegram_id) values('{MEMBER}',123456789);")
    sql("insert into private.telegram_mini_app_limits values(123456789,now(),19);")
    report = "set role service_role;select public.telegram_mini_app_report(123456789,'month');"
    first = held(report, identity=False)
    second = sql(report);finish(first)
    assert json.loads(second.stdout.strip().splitlines()[-1]) == {'error':'rate_limited'}
    assert scalar('select requests from private.telegram_mini_app_limits where telegram_id=123456789;') == '20'
    print('PASS: concurrent Mini App reads cannot exceed the per-ID request window',flush=True)
    sql('delete from private.telegram_mini_app_limits;')
    first = held(f"select pg_advisory_xact_lock(751925,123456789);update public.profiles set blocked=true where id='{USER}';",identity=False)
    second = sql(report);finish(first)
    assert json.loads(second.stdout.strip().splitlines()[-1]) == {'error':'forbidden'}
    print('PASS: Mini App checks current blocking after waiting for the request lock',flush=True)


    sql("insert into private.telegram_mini_app_limits values(222333444,now()-interval '2 days',1);")
    first = held("select 1 from private.telegram_mini_app_limits where telegram_id=222333444 for update;",identity=False)
    second = sql("set lock_timeout='200ms';"+report)
    finish(first)
    assert json.loads(second.stdout.strip().splitlines()[-1]) == {'error':'forbidden'}
    assert scalar('select count(*) from private.telegram_mini_app_limits where telegram_id=222333444;') == '1'
    sql(report)
    assert scalar('select count(*) from private.telegram_mini_app_limits where telegram_id=222333444;') == '0'
    print('PASS: Mini App cleanup skips busy expired windows and removes them on a later request',flush=True)

    if '--restore' in sys.argv:
        from restore_drill import verify_restore
        verify_restore(docker, NAME)

finally:
    if started:
        docker("stop", "-t", "1", NAME, timeout=15)
