#!/usr/bin/env python3
"""Upload encrypted backup + manifest using the server's configured AWS CLI profile."""
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def checksum(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def main():
    if len(sys.argv) != 3:
        raise RuntimeError('Expected encrypted dump and manifest paths')
    destination = os.environ.get('XD_BACKUP_S3_URI', '').rstrip('/')
    if not destination.startswith('s3://') or not destination[5:]:
        raise RuntimeError('Configure XD_BACKUP_S3_URI=s3://bucket/prefix')
    os.umask(0o077)
    with tempfile.TemporaryDirectory() as temporary:
        for arg in sys.argv[1:]:
            source = Path(arg)
            remote = destination + '/' + source.name
            target = Path(temporary) / source.name
            for start, end in [(str(source), remote), (remote, str(target))]:
                result = subprocess.run(['aws', 's3', 'cp', start, end, '--only-show-errors'], capture_output=True)
                if result.returncode:
                    raise RuntimeError('S3 transfer failed; details suppressed')
            if checksum(source) != checksum(target):
                raise RuntimeError('S3 read-back checksum mismatch')
    print('Both backup objects verified by remote read-back.')


if __name__ == '__main__':
    try:
        main()
    except RuntimeError as error:
        raise SystemExit(str(error)) from None
