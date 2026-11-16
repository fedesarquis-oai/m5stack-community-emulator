"""Owned local process/lock tests; no USB, credentials or downloads."""
import io, json, os, subprocess, sys, tempfile, time, unittest, zipfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from scripts import host, hardware

class HostPortabilityTest(unittest.TestCase):
    def test_official_archive_selection_and_unsupported_host_rejection(self):
        for system,machine,suffix in [('Darwin','arm64','macOS_ARM64.tar.gz'),('Darwin','x86_64','macOS_64bit.tar.gz'),('Linux','aarch64','Linux_ARM64.tar.gz'),('Linux','x86_64','Linux_64bit.tar.gz'),('Windows','AMD64','Windows_64bit.zip')]:
            self.assertEqual(host.arduino_asset('1.5.1',system,machine),'arduino-cli_1.5.1_'+suffix)
        for system,machine in [('Windows','ARM64'),('Linux','i686'),('FreeBSD','x86_64')]:
            with self.assertRaisesRegex(RuntimeError,'No installer'):host.arduino_asset('1.5.1',system,machine)

    def test_workspace_lock_excludes_second_owner_and_releases_on_close(self):
        with tempfile.TemporaryDirectory() as directory:
            filename=Path(directory)/'operation.lock'
            first=open(filename,'a+b');second=open(filename,'a+b')
            try:
                host.lock_operation(first)
                with self.assertRaises(BlockingIOError):host.lock_operation(second)
                first.close();host.lock_operation(second)
            finally:first.close();second.close()

    def test_owned_process_can_be_stopped(self):
        child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'],**host.process_options())
        try:
            host.stop_process(child)
            self.assertIsNotNone(child.wait(timeout=10))
        finally:
            if child.poll() is None:child.kill();child.wait(timeout=5)

    def test_private_file_roundtrip_uses_real_os_permissions(self):
        actual_run = subprocess.run
        def diagnostic_run(*args, **kwargs):
            kwargs['stderr'] = subprocess.PIPE
            result = actual_run(*args, **kwargs)
            if result.returncode:
                # This disposable fixture contains no credentials. Keep native
                # ACL failures visible in CI without exposing real user files.
                self.fail(result.stderr.decode(errors='replace')[-4000:])
            return result
        with tempfile.TemporaryDirectory() as directory, patch.object(host.subprocess, 'run', side_effect=diagnostic_run):
            folder=Path(directory);host.protect_private(folder)
            filename=folder/'private.json';filename.write_text('{"fixture":true}')
            host.protect_private(filename);host.verify_private(filename)
            if os.name!='nt':
                filename.chmod(0o644)
                with self.assertRaisesRegex(ValueError,'owner-only'):host.verify_private(filename)

    def test_standard_core_is_separate_and_extra_hardware_remains_unsupported(self):
        core=hardware.profile_config('cores3');se=hardware.profile_config('cores3se')
        self.assertEqual(core['boardEnum'],'board_M5StackCoreS3')
        self.assertEqual(core['flashBytes'],16*1024*1024)
        self.assertIn('PSRAM=enabled',core['fqbn'])
        self.assertNotEqual(core['boardEnum'],se['boardEnum'])
        self.assertIn('motion',core['features']);self.assertNotIn('motion',se['features'])
        self.assertFalse(core['physicalValidated'])
        with tempfile.TemporaryDirectory() as directory,patch.object(hardware,'ROOT',Path(directory)):
            filename=Path(directory)/'firmware.json'
            filename.write_text(json.dumps({'version':1,'requires':core['features'],'audioDuplex':'exclusive'}))
            hardware.requirements('cores3')
            for feature in ['camera','sd','ble','raw_imu','accessories']:
                filename.write_text(json.dumps({'version':1,'requires':[feature]}))
                with self.assertRaisesRegex(ValueError,'not implemented'):hardware.requirements('cores3')

if __name__=='__main__':unittest.main()
