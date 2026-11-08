from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).parents[1] / 'release-needs-migrations.sh'


class ReleaseChanges(unittest.TestCase):
    def test_only_sql_changes_require_database_setup(self):
        with tempfile.TemporaryDirectory() as directory:
            def git(*args):
                return subprocess.check_output(['git', '-C', directory, *args], stderr=subprocess.DEVNULL).decode().strip()
            def commit():
                git('add', '.')
                git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'change')
                return git('rev-parse', 'HEAD')
            def needs(start, end):
                return subprocess.run(['bash', str(SCRIPT.resolve()), start, end], cwd=directory).returncode
            git('init', '-q')
            root = Path(directory)
            migration = root / 'apps/web/supabase/migrations/001.sql'
            migration.parent.mkdir(parents=True)
            migration.write_text('begin; commit;')
            original = commit()
            (root / 'page.tsx').write_text('new site')
            site = commit()
            self.assertEqual(needs(original, site), 1)
            migration.write_text('begin; select 1; commit;')
            sql = commit()
            self.assertEqual(needs(site, sql), 0)
            migration.unlink()
            deleted = commit()
            self.assertEqual(needs(sql, deleted), 0)
            self.assertEqual(needs('0' * 40, deleted), 2)
