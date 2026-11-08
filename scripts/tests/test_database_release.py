import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('release', Path(__file__).parents[1] / 'database-release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class MigrationSafety(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / '202611030018_example.sql'
        self.path.write_text('begin;\nselect 1;\ncommit;\n')
        self.files = patch.object(release, 'files', return_value=[self.path])
        self.files.start()
        self.addCleanup(self.files.stop)

    def test_missing_history_stops_without_backup_or_writes(self):
        with patch.object(release, 'sql', return_value='f') as sql, patch.object(release, 'backup') as backup:
            with self.assertRaisesRegex(RuntimeError, 'history absent'):
                release.migrate()
            backup.assert_not_called()
            self.assertEqual(sql.call_count, 1)

    def test_failed_backup_stops_before_migration(self):
        with patch.object(release, 'sql', side_effect=['t', '']) as sql, patch.object(release, 'backup', side_effect=RuntimeError('upload failed')):
            with self.assertRaisesRegex(RuntimeError, 'upload failed'):
                release.migrate()
            self.assertEqual(sql.call_count, 2)

    def test_modified_applied_migration_stops(self):
        with patch.object(release, 'sql', side_effect=['t', self.path.name + '|bad']), patch.object(release, 'backup') as backup:
            with self.assertRaisesRegex(RuntimeError, 'modified'):
                release.migrate()
            backup.assert_not_called()

    def test_record_is_inside_migration_transaction(self):
        with patch.object(release, 'sql', side_effect=['t', '', '']) as sql, patch.object(release, 'backup'):
            release.migrate()
            statement = sql.call_args.args[0]
            self.assertLess(statement.index('begin;'), statement.index('insert into'))
            self.assertLess(statement.index('insert into'), statement.rindex('commit;'))

    def test_baseline_is_atomic_and_does_not_execute_migration(self):
        with patch.object(release, 'sql', side_effect=['f', '']) as sql, patch.object(release, 'backup'):
            release.migrate(self.path.name)
            statement = sql.call_args.args[0]
            self.assertEqual(statement.count('begin;'), 1)
            self.assertEqual(statement.count('commit;'), 1)
            self.assertNotIn('select 1;', statement)
            self.assertLess(statement.index('begin;'), statement.index('create table'))
            self.assertLess(statement.index('insert into'), statement.index('commit;'))

    def test_unchanged_history_does_not_write(self):
        with patch.object(release, 'sql', side_effect=['t', self.path.name + '|' + release.digest(self.path)]) as sql, patch.object(release, 'backup') as backup:
            release.migrate()
            backup.assert_not_called()
            self.assertEqual(sql.call_count, 2)


if __name__ == '__main__':
    unittest.main()
