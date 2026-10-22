"""Offline setup regressions using real local Git objects and owned fixtures.

Run: python3 -B tests/setup_recovery_test.py
No dependency download, browser, native build, credentials or hardware.
"""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import runpy
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

ROOT=Path(__file__).resolve().parents[1]


class SetupRecoveryTest(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory(prefix='setup-offline-',dir=ROOT/'tests')
        self.addCleanup(self.temporary.cleanup)
        self.base=Path(self.temporary.name)
        self.work=self.base/'workspace with spaces';self.work.mkdir()
        self.origin=self.base/'origin with spaces.git'
        self.git('init','--bare',str(self.origin))
        blob=self.git('--git-dir='+str(self.origin),'hash-object','-w','--stdin',input='fixture source\n').strip()
        tree=self.git('--git-dir='+str(self.origin),'mktree',input='100644 blob '+blob+'\tsource.txt\n').strip()
        self.commit=self.git('-c','user.name=Setup Fixture','-c','user.email=setup-fixture@invalid',
                             '--git-dir='+str(self.origin),'commit-tree',tree,input='Local setup fixture\n').strip()
        self.git('--git-dir='+str(self.origin),'update-ref','refs/heads/main',self.commit)
        self.dep={'url':self.origin.as_uri(),'commit':self.commit,'ref':'main'}
        (self.work/'dependencies.lock.json').write_text(json.dumps({'fixture':self.dep}))
        self.module=runpy.run_path(str(ROOT/'m5preview'),run_name='setup_recovery_fixture')
        self.scope=self.module['setup'].__globals__
        self.scope['ROOT']=self.work
        self.folder=self.work/'vendor/fixture'

    def git(self,*args,input=None):
        result=subprocess.run(['git',*args],input=input,text=True,capture_output=True,timeout=5)
        self.assertEqual(result.returncode,0,result.stderr)
        return result.stdout

    def setup(self):
        with contextlib.redirect_stdout(io.StringIO()):self.module['setup'](browser_only=True)

    def snapshot(self,path):
        return {str(p.relative_to(path)):(os.readlink(p) if p.is_symlink() else
                hashlib.sha256(p.read_bytes()).hexdigest()) for p in path.rglob('*') if p.is_file() or p.is_symlink()}

    def test_real_failed_fetch_then_retry_success_with_spaces_and_clean_pin(self):
        hidden=self.origin.with_name('origin temporarily unavailable.git');self.origin.rename(hidden)
        with self.assertRaisesRegex(RuntimeError,'fixture was not installed.*setup --browser-only'):self.setup()
        self.assertFalse(self.folder.exists(),'Failed fetch must not publish an incomplete checkout')
        hidden.rename(self.origin)
        self.setup()
        self.module['verify_dependencies']()
        self.assertEqual((self.folder/'source.txt').read_text(),'fixture source\n')
        self.assertFalse((self.folder/self.module['SETUP_MARKER']).exists())
        actual=self.module['git_output']
        with mock.patch.dict(self.scope,{'git_output':mock.Mock(wraps=actual)}) as unused:
            self.setup()
            self.assertFalse(any('fetch' in call.args[1:] for call in self.scope['git_output'].call_args_list))

    def test_existing_empty_dirty_corrupt_and_unborn_paths_preserved(self):
        self.folder.mkdir(parents=True)
        with self.assertRaisesRegex(RuntimeError,'existing files were preserved.*backup path'):self.setup()
        self.assertTrue(self.folder.is_dir());self.assertEqual(list(self.folder.iterdir()),[])
        note=self.folder/'participant-note.txt';note.write_text('keep me\n')
        before=self.snapshot(self.folder)
        with self.assertRaises(RuntimeError):self.setup()
        self.assertEqual(self.snapshot(self.folder),before)
        self.git('init',str(self.folder))
        self.git('-C',str(self.folder),'remote','add','origin',self.dep['url'])
        before=self.snapshot(self.folder)
        with self.assertRaisesRegex(RuntimeError,'backup path'):self.setup()
        self.assertEqual(self.snapshot(self.folder),before)

    def test_existing_dirty_or_wrong_pin_checkout_is_not_reset(self):
        self.setup()
        note=self.folder/'participant-note.txt';note.write_text('keep me\n')
        before=self.snapshot(self.folder)
        with self.assertRaisesRegex(RuntimeError,'local changes'):self.setup()
        self.assertEqual(self.snapshot(self.folder),before)
        note.unlink();before=self.snapshot(self.folder)
        self.dep['commit']='0'*40
        (self.work/'dependencies.lock.json').write_text(json.dumps({'fixture':self.dep}))
        with self.assertRaisesRegex(RuntimeError,'exact pin'):self.setup()
        self.assertEqual(self.snapshot(self.folder),before)

    def test_concurrent_empty_destination_is_not_replaced(self):
        verify=self.module['verify_checkout']
        concurrent=[]
        def verify_then_reserve(path,*args,**kwargs):
            result=verify(path,*args,**kwargs)
            if '-fetch-' in path.name and not concurrent:
                self.folder.mkdir();concurrent.append(self.folder.stat().st_ino)
            return result
        with mock.patch.dict(self.scope,{'verify_checkout':verify_then_reserve}):
            with self.assertRaisesRegex(RuntimeError,'existing files were preserved'):self.setup()
        self.assertEqual(self.folder.stat().st_ino,concurrent[0])
        self.assertEqual(list(self.folder.iterdir()),[])

    def test_partial_publication_and_user_file_preserved_for_manual_recovery(self):
        def fail_copy(source,destination_fd):
            with os.fdopen(os.open('participant-note.txt',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600,dir_fd=destination_fd),'w') as stream:
                stream.write('keep me\n')
            raise OSError('injected publication failure')
        with mock.patch.dict(self.scope,{'copy_checkout_exclusive':fail_copy}):
            with self.assertRaisesRegex(RuntimeError,'backup path'):self.setup()
        self.assertEqual((self.folder/'participant-note.txt').read_text(),'keep me\n')
        self.assertTrue((self.folder/self.module['SETUP_MARKER']).is_file())
        before=self.snapshot(self.folder)
        with self.assertRaises(RuntimeError):self.setup()
        self.assertEqual(self.snapshot(self.folder),before)

    def test_replaced_final_directory_receives_no_publication_writes(self):
        publish=self.module['copy_checkout_exclusive']
        moved=self.work/'vendor/moved-owned-reservation'
        def replace_then_copy(source,destination_fd):
            if not moved.exists():
                self.folder.rename(moved);self.folder.mkdir()
                (self.folder/'participant-note.txt').write_text('keep me\n')
            publish(source,destination_fd)
        with mock.patch.dict(self.scope,{'copy_checkout_exclusive':replace_then_copy}):
            with self.assertRaisesRegex(RuntimeError,'directory was replaced'):self.setup()
        self.assertEqual(self.snapshot(self.folder),{'participant-note.txt':hashlib.sha256(b'keep me\n').hexdigest()})
        self.assertTrue((moved/self.module['SETUP_MARKER']).is_file())

    def test_changed_marker_not_removed(self):
        verify=self.module['verify_checkout']
        def change_marker(path,*args,**kwargs):
            result=verify(path,*args,**kwargs)
            if kwargs.get('marker') is not None:
                (path/self.module['SETUP_MARKER']).write_text('participant changed marker\n')
            return result
        with mock.patch.dict(self.scope,{'verify_checkout':change_marker}):
            with self.assertRaisesRegex(RuntimeError,'marker changed'):self.setup()
        self.assertEqual((self.folder/self.module['SETUP_MARKER']).read_text(),'participant changed marker\n')

    def test_routing_environment_cannot_redirect_checkout_and_policy_is_preserved(self):
        outside=self.base/'unrelated';outside.mkdir();(outside/'keep.txt').write_text('unchanged\n')
        env={'GIT_DIR':str(outside),'GIT_WORK_TREE':str(outside),'GIT_COMMON_DIR':str(outside),
             'GIT_INDEX_FILE':str(outside/'index'),'GIT_OBJECT_DIRECTORY':str(outside/'objects'),
             'GIT_ALTERNATE_OBJECT_DIRECTORIES':str(outside),
             'GIT_CONFIG_COUNT':'2','GIT_CONFIG_KEY_0':'core.worktree','GIT_CONFIG_VALUE_0':str(outside),
             'GIT_CONFIG_KEY_1':'http.sslVerify','GIT_CONFIG_VALUE_1':'true'}
        with mock.patch.dict(os.environ,env):
            isolated=self.module['git_environment']()
            self.assertNotIn('GIT_DIR',isolated)
            self.assertNotIn('GIT_OBJECT_DIRECTORY',isolated)
            self.assertEqual(isolated['GIT_CONFIG_VALUE_1'],'true')
            self.assertEqual(isolated['GIT_CONFIG_COUNT'],'2')
            self.assertEqual(isolated['GIT_TERMINAL_PROMPT'],'0')
            self.assertEqual(isolated['GCM_INTERACTIVE'],'never')
            self.setup()
        self.assertEqual(self.snapshot(outside),{'keep.txt':hashlib.sha256(b'unchanged\n').hexdigest()})

    def test_symlink_vendor_or_dependency_is_preserved(self):
        outside=self.base/'outside';outside.mkdir();(outside/'keep.txt').write_text('keep\n')
        (self.work/'vendor').symlink_to(outside,target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError,'symlink'):self.setup()
        self.assertEqual((outside/'keep.txt').read_text(),'keep\n')
        (self.work/'vendor').unlink();(self.work/'vendor').mkdir()
        self.folder.symlink_to(outside,target_is_directory=True)
        with self.assertRaises(RuntimeError):self.setup()
        self.assertTrue(self.folder.is_symlink());self.assertEqual((outside/'keep.txt').read_text(),'keep\n')

    def test_replaced_stage_cleanup_never_follows_symlink_or_deletes_new_directory(self):
        stage=self.base/'owned-stage';stage.mkdir();info=stage.stat()
        identity=(info.st_dev,info.st_ino)
        moved=self.base/'moved-owned-stage';stage.rename(moved)
        outside=self.base/'user-directory';outside.mkdir();(outside/'keep.txt').write_text('keep\n')
        stage.symlink_to(outside,target_is_directory=True)
        self.module['cleanup_owned_stage'](stage,identity)
        self.assertTrue(stage.is_symlink());self.assertTrue((outside/'keep.txt').exists())
        stage.unlink();stage.mkdir();(stage/'user-file').write_text('keep\n')
        self.module['cleanup_owned_stage'](stage,identity)
        self.assertTrue((stage/'user-file').exists())

    def test_git_timeout_stops_descendants_holding_pipes(self):
        real_popen=subprocess.Popen
        child_pid_file=self.base/'child.pid'
        child_exit_file=self.base/'child-exited.txt'
        child_code=('import os,time,signal,sys; '
                    'signal.signal(signal.SIGTERM,lambda *args:(open('+repr(str(child_exit_file))+',"w").write("terminated"),sys.exit(0))); '
                    'open('+repr(str(child_pid_file))+',"w").write(str(os.getpid())); time.sleep(30)')
        parent_code='import subprocess,sys,time; subprocess.Popen([sys.executable,"-c",'+repr(child_code)+']); time.sleep(30)'
        processes=[]
        def launch_owned_fake_git(*unused,**kwargs):
            process=real_popen([sys.executable,'-c',parent_code],**kwargs)
            processes.append(process);return process
        try:
            started=time.monotonic()
            with mock.patch.object(subprocess,'Popen',side_effect=launch_owned_fake_git):
                with self.assertRaisesRegex(RuntimeError,'timed out'):
                    self.module['git_output'](self.work,'fetch',timeout=.3)
            self.assertLess(time.monotonic()-started,3)
            self.assertIsNotNone(processes[0].poll())
            self.assertTrue(child_pid_file.exists())
            self.assertEqual(child_exit_file.read_text(),'terminated')
            # communicate completed: the descendant also released inherited
            # stdout/stderr, and its own handler recorded orderly termination.
        finally:
            for process in processes:
                try:os.killpg(process.pid,signal.SIGKILL)
                except ProcessLookupError:pass
                process.wait(timeout=2)

    def test_keyboard_interrupt_stops_owned_git_before_propagating(self):
        real_popen=subprocess.Popen
        processes=[]
        def launch_interrupting_git(*unused,**kwargs):
            process=real_popen([sys.executable,'-c','import time; time.sleep(30)'],**kwargs)
            process.communicate=mock.Mock(side_effect=KeyboardInterrupt)
            processes.append(process);return process
        try:
            with mock.patch.object(subprocess,'Popen',side_effect=launch_interrupting_git):
                with self.assertRaises(KeyboardInterrupt):
                    self.module['git_output'](self.work,'fetch')
            self.assertIsNotNone(processes[0].poll())
            self.assertTrue(processes[0].stdout.closed)
            self.assertTrue(processes[0].stderr.closed)
        finally:
            for process in processes:
                try:os.killpg(process.pid,signal.SIGKILL)
                except ProcessLookupError:pass
                process.wait(timeout=2)

    def test_missing_dependencies_and_tools_give_browser_only_guidance(self):
        with self.assertRaisesRegex(RuntimeError,'fixture.*setup --browser-only'):
            self.module['verify_dependencies']()
        with mock.patch.object(shutil,'which',return_value=None):
            with self.assertRaisesRegex(RuntimeError,'Required existing system tool missing: git'):
                self.setup()
        with mock.patch.object(shutil,'which',side_effect=lambda name:None if name=='make' else '/fixture/'+name):
            self.setup()
            self.module['setup'](browser_only=False) # SDL/make is no longer required.


if __name__=='__main__':unittest.main(verbosity=2)
