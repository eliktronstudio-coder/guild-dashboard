import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('upload', Path(__file__).parents[1] / 'upload-backup-s3.py')
upload = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upload)


class UploadIntegrity(unittest.TestCase):
    def exercise(self, corrupt=False, fail=False):
        with tempfile.TemporaryDirectory() as directory:
            paths = [Path(directory) / name for name in ['copy.dump.gpg', 'copy.dump.json']]
            for path in paths:
                path.write_bytes(b'encrypted-or-manifest')
            remote = {}

            def transfer(args, **kwargs):
                start, end = args[3:5]
                if fail:
                    return subprocess.CompletedProcess(args, 1)
                if end.startswith('s3://'):
                    remote[end] = Path(start).read_bytes()
                else:
                    Path(end).write_bytes(b'corrupt' if corrupt else remote[start])
                return subprocess.CompletedProcess(args, 0)

            with patch.dict(os.environ, {'XD_BACKUP_S3_URI': 's3://test-bucket/backups'}), patch.object(upload.subprocess, 'run', side_effect=transfer) as run, patch.object(upload.sys, 'argv', ['upload'] + list(map(str, paths))):
                upload.main()
                self.assertEqual(run.call_count, 4)

    def test_roundtrip_checks_both_objects(self):
        self.exercise()

    def test_corrupt_download_fails(self):
        with self.assertRaisesRegex(RuntimeError, 'checksum mismatch'):
            self.exercise(corrupt=True)

    def test_failed_transfer_fails(self):
        with self.assertRaisesRegex(RuntimeError, 'transfer failed'):
            self.exercise(fail=True)
