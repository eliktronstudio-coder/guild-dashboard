"""Restore synthetic test data only, inside the caller's disposable offline container."""
import json


def verify_restore(docker, container):
    def command(*args):
        result = docker('exec', '-i', container, *args, timeout=60)
        if result.returncode:
            raise AssertionError(result.stderr)
        return result.stdout

    def query(database, statement):
        result = docker('exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                        '-U', 'postgres', '-d', database, input=statement, timeout=30)
        if result.returncode:
            raise AssertionError(result.stderr)
        return result.stdout.strip()

    tables = json.loads(query('postgres', "select json_agg(format('%I.%I',schemaname,tablename) order by schemaname,tablename) from pg_tables where schemaname in ('public','private','auth');"))
    def snapshot(database):
        data = {}
        for table in tables:
            data[table] = query(database, f"select count(*)::text||':'||md5(coalesce(string_agg(to_jsonb(r)::text,E'\\n' order by to_jsonb(r)::text),'')) from {table} r;")
        data['security'] = query(database, """
select jsonb_build_object(
 'relations',(select jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,coalesce(c.relacl,acldefault(case when c.relkind='S' then 's'::"char" else 'r'::"char" end,c.relowner))) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','auth') and c.relkind in ('r','v','S')),
 'constraints',(select jsonb_agg(jsonb_build_array(n.nspname,c.relname,k.conname,pg_get_constraintdef(k.oid),k.convalidated) order by n.nspname,c.relname,k.conname) from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','auth')),
 'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p where schemaname in ('public','private','auth')),
 'functions',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),p.prosecdef,coalesce(p.proacl,acldefault('f',p.proowner)),p.proconfig,p.prosrc) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private','auth')));
""")
        security = json.loads(data['security'])
        for row in security['relations'] or []:
            if row[-1] is not None: row[-1].sort()
        for row in security['functions'] or []:
            if row[4] is not None: row[4].sort()
        data['security'] = security
        sequences = json.loads(query(database, "select coalesce(json_agg(format('%I.%I',schemaname,sequencename) order by schemaname,sequencename),'[]') from pg_sequences where schemaname in ('public','private','auth');"))
        for sequence in sequences:
            data['sequence:'+sequence] = query(database, f'select last_value::text||\':\'||is_called::text from {sequence};')
        return data

    before = snapshot('postgres')
    command('pg_dump', '-U', 'postgres', '-d', 'postgres', '-Fc', '--no-owner', '-f', '/tmp/xd-fixture.dump')
    command('createdb', '-U', 'postgres', '-T', 'template0', 'xd_restore_drill')
    command('pg_restore', '-U', 'postgres', '-d', 'xd_restore_drill', '--no-owner', '--exit-on-error', '--single-transaction', '/tmp/xd-fixture.dump')
    after = snapshot('xd_restore_drill')
    differences = [key for key in before if before[key] != after.get(key)]
    assert not differences, 'Restored sections differ: ' + ', '.join(differences)
    assert query('xd_restore_drill', "select has_function_privilege('anon','public.finance_export(text,timestamptz,timestamptz)','execute');") == 'f'
    assert query('xd_restore_drill', "select has_function_privilege('authenticated','public.receive_telegram_update(bigint,bigint,text,text,text,uuid)','execute');") == 'f'
    denied = docker('exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'xd_restore_drill', input='set role anon;select * from private.telegram_links;', timeout=15)
    assert denied.returncode != 0 and 'permission denied' in denied.stderr
    print(f'PASS: backup restored {len(tables)} tables with identical row digests, sequences, RLS, grants and function definitions; anonymous access remains denied', flush=True)
