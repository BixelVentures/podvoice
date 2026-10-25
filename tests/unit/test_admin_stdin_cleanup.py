"""Disposable CI data cleanup only; fake Docker ordering plus Linux permissions."""

import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/check_podview_admin_stdin.sh"

FAKE = r"""
import json, os, pathlib, subprocess, sys
tool=pathlib.Path(sys.argv[0]).name
args=sys.argv[1:]
state=pathlib.Path(os.environ['FAKE_STATE'])
with (state/'events').open('a') as f: f.write(json.dumps([tool,*args])+'\n')
if tool=='timeout':
    assert args[:2] in (['--kill-after=2s','5s'],['--kill-after=2s','3s'])
    os.execvp(args[2],args[2:])
if tool=='rm':
    root=pathlib.Path(args[-1])
    if (root/'data/private/payload').exists() and not (state/'restored').exists():
        sys.exit(1) # Linux non-owner cannot descend into the modeled root0700 dir.
    sys.exit(subprocess.call(['/bin/rm',*args]))
if args[:2]==['image','inspect']: print('sha256:inert-fixture')
elif args[0]=='run':
    mount=args[args.index('--mount')+1]
    source=mount.split('source=',1)[1].split(',',1)[0]
    (state/'source').write_text(source)
    private=pathlib.Path(source)/'private'
    private.mkdir(mode=0o700); (private/'payload').write_text('inert')
    assert private.stat().st_mode & 0o777 == 0o700
elif args[0]=='inspect':
    print('true true ["/init"] ["/run.sh"]' if 'Entrypoint' in args[-1] else 'true')
elif args[0]=='logs': print('podvoice admin stdin rejected')
elif args[0]=='top':
    print('1 0 python -m gatekeeper')
    sys.exit(int(os.environ.get('FAKE_PROBE_STATUS','0')))
elif args[0]=='exec':
    assert args[:3]==['exec','--user','0:0']
    assert args[4:]==['chown','-R','-h','--',f'{os.getuid()}:{os.getgid()}','/data']
    if os.environ.get('FAKE_CLEANUP_FAIL')=='1': sys.exit(9)
    (state/'restored').write_text('ownership restored, mode unchanged')
elif args[0] not in ('attach','rm'): raise AssertionError(args)
"""


class AdminStdinCleanup(unittest.TestCase):
    def run_probe(self, *, probe=0, cleanup=False):
        with tempfile.TemporaryDirectory() as folder:
            state = Path(folder)
            tools = state / "bin"
            tools.mkdir()
            for name in ("docker", "timeout", "rm"):
                path = tools / name
                path.write_text(f"#!{sys.executable}\n" + FAKE)
                path.chmod(0o755)
            env = {
                **os.environ,
                "PATH": str(tools) + os.pathsep + os.environ["PATH"],
                "FAKE_STATE": str(state),
                "FAKE_PROBE_STATUS": str(probe),
                "FAKE_CLEANUP_FAIL": "1" if cleanup else "0",
            }
            result = subprocess.run(
                ["bash", str(SCRIPT), "inert-image"],
                env=env,
                capture_output=True,
                text=True,
                timeout=10,
            )
            events = [json.loads(line) for line in (state / "events").read_text().splitlines()]
            root = Path((state / "source").read_text()).parent
            removed = not root.exists()
            if root.exists():
                shutil.rmtree(root)
            return result, events, removed

    def test_success_restores_only_data_before_container_and_host_removal(self):
        result, events, removed = self.run_probe()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(removed)
        commands = [row for row in events if row[0] != "timeout"]
        restore = next(i for i, row in enumerate(commands) if row[:2] == ["docker", "exec"])
        remove = next(i for i, row in enumerate(commands) if row[:2] == ["docker", "rm"])
        host = next(i for i, row in enumerate(commands) if row[0] == "rm")
        self.assertLess(restore, remove)
        self.assertLess(remove, host)
        bounded = [
            row
            for row in events
            if row[:5] == ["timeout", "--kill-after=2s", "5s", "docker", "exec"]
        ]
        self.assertEqual(len(bounded), 1)
        self.assertNotIn("sudo", json.dumps(events))
        self.assertNotIn("chmod", json.dumps(events))

    def test_cleanup_failure_fails_successful_probe_and_preserves_original_failure(self):
        for probe, failure, expected in ((0, True, 1), (23, False, 23), (23, True, 23)):
            with self.subTest(probe=probe, cleanup=failure):
                result, _, removed = self.run_probe(probe=probe, cleanup=failure)
                self.assertEqual(result.returncode, expected, result.stderr)
                self.assertEqual(removed, not failure)

    @unittest.skipUnless(
        platform.system() == "Linux" and os.geteuid() == 0,
        "actual root0700 ownership regression runs inside disposable Linux",
    )
    def test_linux_private_root_fixture_requires_ownership_restore_without_mode_change(self):
        with tempfile.TemporaryDirectory() as folder, tempfile.TemporaryDirectory() as external:
            root = Path(folder)
            os.chown(root, 65534, 65534)
            data = root / "data"
            data.mkdir(mode=0o700)
            os.chown(data, 65534, 65534)
            private = data / "podview-client-diagnostics"
            private.mkdir(mode=0o700)
            (private / "records.json").write_text("{}")
            outside = Path(external) / "outside-fixture-data"
            outside.write_text("unchanged")
            (private / "outside-link").symlink_to(outside)

            def unprivileged():
                os.setgroups([])
                os.setgid(65534)
                os.setuid(65534)

            before = subprocess.run(
                ["rm", "-rf", str(root)], preexec_fn=unprivileged, capture_output=True
            )
            self.assertNotEqual(before.returncode, 0)
            self.assertEqual(private.stat().st_uid, 0)
            subprocess.run(["chown", "-R", "-h", "--", "65534:65534", str(data)], check=True)
            self.assertEqual(private.stat().st_mode & 0o777, 0o700)
            self.assertEqual(outside.stat().st_uid, 0)
            self.assertEqual((private / "outside-link").lstat().st_uid, 65534)
            after = subprocess.run(
                ["rm", "-rf", str(root)], preexec_fn=unprivileged, capture_output=True
            )
            self.assertEqual(after.returncode, 0, after.stderr)
            self.assertFalse(root.exists())


if __name__ == "__main__":
    unittest.main()
