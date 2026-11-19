"""Read-only bot, Discord, vision readiness and persistent budget diagnostics; no inference."""
import pathlib,subprocess,os
root=pathlib.Path(__file__).resolve().parents[2]
ssh=['ssh','-i',os.path.expanduser('~/.ssh/xd_operations'),'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=20','root@200.165.236.194']
p=subprocess.run(ssh+['python3 -'],input=(root/'operations/audit-discord-runtime.py').read_text(),text=True,capture_output=True,timeout=240)
if p.stdout:print(p.stdout,flush=True)
if p.returncode:raise SystemExit('BOT_AUDIT_COMMAND_FAILED')
