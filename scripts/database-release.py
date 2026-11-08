#!/usr/bin/env python3
"""Root-only PostgreSQL backup/migration runner. Credentials use libpq service files."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / 'apps/web/supabase/migrations'
TABLE = 'private.xd_release_migrations'


def run(args, **kwargs):
    # Database errors can contain user data; retain them outside CI output.
    result = subprocess.run(args, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed; operation stopped (details suppressed).')
    return result.stdout


def sql(statement):
    return run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=statement.encode()).decode().strip()


def files():
    result = sorted(MIGRATIONS.glob('*.sql'))
    for path in result:
        if not re.fullmatch(r'\d{12}_[a-z0-9_]+\.sql', path.name):
            raise RuntimeError('Invalid migration filename')
    return result


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def backup():
    destination = Path(os.environ['XD_BACKUP_DIR'])
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    target = destination / (stamp + '.dump.gpg')
    uploader = os.environ['XD_BACKUP_UPLOAD']
    if not Path(uploader).is_absolute() or not os.access(uploader, os.X_OK):
        raise RuntimeError('Configure an absolute executable XD_BACKUP_UPLOAD')
    with tempfile.TemporaryDirectory(dir=destination) as temporary:
        dump = Path(temporary) / 'database.dump'
        run(['pg_dump', '--format=custom', '--file', str(dump)])
        run(['pg_restore', '--list', str(dump)])
        run(['gpg', '--batch', '--yes', '--trust-model', 'always', '--encrypt',
             '--recipient', os.environ['XD_BACKUP_RECIPIENT'], '--output', str(target), str(dump)])
    manifest = target.with_suffix('.json')
    manifest.write_text(json.dumps({
        'utc': stamp, 'commit': run(['git', '-C', str(ROOT), 'rev-parse', 'HEAD']).decode().strip(),
        'sha256': digest(target), 'bytes': target.stat().st_size,
        'pg_dump': run(['pg_dump', '--version']).decode().strip(),
        'server_version': sql('show server_version;'),
        'scope': 'Entire database readable by backup role; no schema exclusions. Storage objects and provider settings excluded.',
        'migrations': {p.name: digest(p) for p in files()},
    }, indent=2) + '\n')
    # Contract: uploader verifies remote checksum and returns nonzero on failure.
    run([uploader, str(target), str(manifest)])
    print('Encrypted database backup uploaded and verified by configured uploader.')


def migrate(baseline=None):
    paths = files()
    exists = sql(f"select to_regclass('{TABLE}') is not null;") == 't'
    if not exists and baseline is None:
        raise RuntimeError('Migration history absent: verify existing schema and initialize baseline first.')
    if exists and baseline is not None:
        raise RuntimeError('Baseline already initialized; refusing to replace history.')
    if baseline is not None and baseline not in [p.name for p in paths]:
        raise RuntimeError('Baseline must be an exact existing migration filename.')
    history = dict(line.split('|') for line in sql(f'select filename, sha256 from {TABLE} order by filename;').splitlines()) if exists else {}
    known = {p.name: digest(p) for p in paths}
    if any(known.get(name) != checksum for name, checksum in history.items()):
        raise RuntimeError('Applied migration missing or modified.')
    applied = [p.name for p in paths if p.name in history]
    if applied != [p.name for p in paths[:len(applied)]]:
        raise RuntimeError('Migration history is not a contiguous prefix.')
    pending = [p for p in paths if p.name not in history]
    if not pending:
        print('Database migrations current.')
        return
    # Backup must complete offsite before any database writes, including baseline.
    backup()
    statements = ["select pg_advisory_lock(734219875);", "set lock_timeout = '15s';", "set statement_timeout = '120s';"]
    if baseline is not None:
        statements.append('begin;')
    if not exists:
        statements += [f'''
create schema if not exists private;
create table {TABLE}(filename text primary key, sha256 text not null, applied_at timestamptz not null default now());
revoke all on {TABLE} from public, anon, authenticated;''']
    for path in pending:
        record = f"insert into {TABLE}(filename,sha256) values ('{path.name}','{digest(path)}');"
        if baseline is not None:
            if path.name <= baseline:
                statements.append(record)
            continue
        content = path.read_text().strip()
        if not content.lower().startswith('begin;') or not content.lower().endswith('commit;'):
            raise RuntimeError('Migration must have explicit begin/commit boundaries.')
        statements.append(content[:-len('commit;')] + '\n' + record + '\ncommit;')
    if baseline is not None:
        statements.append('commit;')
    sql('\n'.join(statements))
    print('Migration baseline recorded.' if baseline else 'Database migrations applied.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['backup', 'migrate', 'baseline'])
    parser.add_argument('--through', help='Last migration independently verified in production')
    args = parser.parse_args()
    os.umask(0o077)
    if os.geteuid() != 0:
        parser.error('Run as root on deployment host')
    if not os.environ.get('PGSERVICE') or os.environ.get('PGSSLMODE') != 'verify-full':
        parser.error('Set PGSERVICE and PGSSLMODE=verify-full in protected configuration')
    if args.operation == 'baseline' and not args.through:
        parser.error('baseline requires --through')
    try:
        backup() if args.operation == 'backup' else migrate(args.through if args.operation == 'baseline' else None)
    except (RuntimeError, KeyError) as error:
        raise SystemExit(str(error)) from None
