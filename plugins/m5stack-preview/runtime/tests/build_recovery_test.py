"""Offline build recovery with a tiny real C/C++ program and local Git index.

No dependency download, browser, microphone or hardware. Requires Clang and Git.
"""
import contextlib
import io
import json
import os
from pathlib import Path
import runpy
import subprocess
import tempfile
import types
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]


class BuildRecoveryTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='m5-build-recovery-')
        self.addCleanup(temporary.cleanup)
        self.work = Path(temporary.name) / 'workspace with spaces'
        for folder in ('src', 'vendor/lvgl/src', 'vendor/M5GFX/src/lgfx/Fonts', 'data'):
            (self.work / folder).mkdir(parents=True, exist_ok=True)
        (self.work / 'src/virtual_device.cpp').write_text('extern "C" int fixture_value(); int main() { return fixture_value() < 0; }\n')
        (self.work / 'src/lv_conf.h').write_text('// unused in tiny fixture\n')
        (self.work / 'vendor/M5GFX/src/lgfx/Fonts/glcdfont.h').write_text('// fixture font\n')
        (self.work / 'dependencies.lock.json').write_text('{}\n')
        (self.work / 'scripts').mkdir()
        (self.work / 'scripts/virtual_device.py').write_bytes((ROOT / 'scripts/virtual_device.py').read_bytes())
        self.source = self.work / 'vendor/lvgl/src/fixture.c'
        self.source.write_text('int fixture_value(void) { return 1; }\n')
        for args in (['init', str(self.work / 'vendor/lvgl')], ['-C', str(self.work / 'vendor/lvgl'), 'add', 'src']):
            subprocess.run(['git', *args], check=True, capture_output=True, timeout=5)
        self.module = runpy.run_path(str(ROOT / 'scripts/virtual_device.py'))
        self.scope = self.module['build'].__globals__
        self.scope.update(ROOT=self.work, BUILD=self.work / '.build/virtual-device')
        setup = runpy.run_path(str(ROOT / 'm5preview'), run_name='build_recovery_fixture')
        self.fail_compile = False
        self.workflow = types.SimpleNamespace(verify_dependencies=lambda: None, run=self.run_command, git_output=setup['git_output'])

    def run_command(self, args, log=None):
        args = [str(arg) for arg in args]
        if self.fail_compile and '-c' in args and str(self.source) in args:
            # A killed/failing compiler can leave output bytes behind. The next
            # build must not mistake those bytes for a reusable object.
            Path(args[args.index('-o') + 1]).write_bytes(b'incomplete object')
            raise RuntimeError('injected compiler interruption')
        return subprocess.run(args, check=True, capture_output=True, timeout=15)

    def build(self):
        with contextlib.redirect_stdout(io.StringIO()):
            return self.module['build'](self.workflow, 'cores3se')

    def test_failed_compile_preserves_receipt_and_next_build_recovers(self):
        before = self.build()
        receipt = self.module['metadata_path']('cores3se')
        saved = receipt.read_bytes()
        self.source.write_text('int fixture_value(void) { return 2; }\n')
        self.fail_compile = True
        with self.assertRaisesRegex(RuntimeError, 'injected compiler interruption'):
            self.build()
        self.assertEqual(receipt.read_bytes(), saved)
        self.assertTrue((receipt.parent / before['binary']).is_file())
        self.fail_compile = False
        after = self.build()
        self.assertEqual(json.loads(receipt.read_text()), after)
        subprocess.run([str(receipt.parent / after['binary'])], check=True, timeout=3)
        self.assertFalse(any(p.read_bytes() == b'incomplete object' for p in receipt.parent.glob('*.o')))

    def test_inherited_git_routing_does_not_change_build_source_inventory(self):
        with mock.patch.dict(os.environ, {'GIT_DIR': str(self.work / 'unrelated.git'), 'GIT_WORK_TREE': str(self.work / 'unrelated')}):
            result = self.build()
        subprocess.run([str(self.scope['BUILD'] / result['binary'])], check=True, timeout=3)


if __name__ == '__main__':
    unittest.main()
