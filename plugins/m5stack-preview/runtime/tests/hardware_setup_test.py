"""Git setup regressions; owned local fixtures only, no downloads or USB."""
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('hardware_setup',ROOT/'scripts/hardware.py')
hw=importlib.util.module_from_spec(spec);spec.loader.exec_module(hw)


class HardwareSetupTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='hardware git setup ')
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve()
        self.dist=self.root/'selected git'
        (self.dist/'bin').mkdir(parents=True)
        self.helpers=self.dist/'libexec/git-core';self.helpers.mkdir(parents=True)
        self.templates=self.dist/'share/git-core/templates';self.templates.mkdir(parents=True)
        self.git=self.dist/'bin/git'
        self.git.write_text('#!'+sys.executable+'\nimport os,sys\n'
            'if sys.argv[1]=="config": sys.exit(0 if os.environ.get("M5_SETUP_TEMPLATE_FIXTURE") else 1)\n'
            'print(os.environ.get("GIT_EXEC_PATH", "/missing-relocated-git/libexec/git-core"))\n')
        self.git.chmod(0o755)
        self.helper=self.helpers/'git-remote-https';self.helper.write_text('#!/bin/sh\nexit 0\n');self.helper.chmod(0o755)
        self.env={'PATH':str(self.dist/'bin')+os.pathsep+os.defpath,'HOME':str(self.root)}

    def test_truncated_host_environment_recovers_selected_distribution(self):
        with patch.dict(os.environ,self.env,clear=True):env=hw.git_environment()
        self.assertEqual(env['GIT_EXEC_PATH'],str(self.helpers))
        self.assertEqual(env['GIT_TEMPLATE_DIR'],str(self.templates))
        self.assertEqual(env['PATH'],self.env['PATH'])
        self.assertEqual(env['GIT_TERMINAL_PROMPT'],'0')

    def test_explicit_helpers_templates_and_policy_are_preserved(self):
        other=self.root/'approved helpers';other.mkdir()
        (other/'git-remote-https').symlink_to(self.helper)
        policy={'GIT_EXEC_PATH':str(other),'GIT_TEMPLATE_DIR':'',
                'GIT_CONFIG_GLOBAL':str(self.root/'company.gitconfig'),
                'GIT_CONFIG_COUNT':'1','GIT_CONFIG_KEY_0':'http.sslVerify','GIT_CONFIG_VALUE_0':'true',
                'HTTPS_PROXY':'http://company-proxy.invalid','GIT_CONFIG_NOSYSTEM':'0'}
        routing={'GIT_DIR':str(self.root/'unrelated.git'),'GIT_WORK_TREE':str(self.root/'unrelated')}
        with patch.dict(os.environ,{**self.env,**policy,**routing},clear=True):env=hw.git_environment()
        for key,value in policy.items():self.assertEqual(env[key],value)
        for key in routing:self.assertNotIn(key,env)

    def test_configured_template_directory_is_not_overridden(self):
        with patch.dict(os.environ,{**self.env,'M5_SETUP_TEMPLATE_FIXTURE':'configured'},clear=True):env=hw.git_environment()
        self.assertEqual(env['GIT_EXEC_PATH'],str(self.helpers))
        self.assertNotIn('GIT_TEMPLATE_DIR',env)

    def test_invalid_explicit_override_is_not_silently_replaced(self):
        with patch.dict(os.environ,{**self.env,'GIT_EXEC_PATH':str(self.root/'invalid')},clear=True):
            with self.assertRaisesRegex(RuntimeError,'approved GIT_EXEC_PATH'):hw.git_environment()

    def test_setup_fails_before_downloads_or_configuration_when_helper_is_missing(self):
        self.helper.unlink()
        with patch.dict(os.environ,self.env,clear=True),patch.object(hw,'ROOT',self.root), \
             patch.object(hw.platform,'system',return_value='Darwin'),patch.object(hw.platform,'machine',return_value='arm64'), \
             patch.object(hw.urllib.request,'urlopen') as download,patch.object(hw,'configure') as configure,patch.object(hw,'run') as run:
            with self.assertRaisesRegex(RuntimeError,'No hardware tooling was downloaded'):hw.setup()
        download.assert_not_called();configure.assert_not_called();run.assert_not_called()

    def test_missing_git_and_probe_errors_are_actionable_without_echoing_stderr(self):
        with patch.dict(os.environ,{'PATH':str(self.root/'absent')},clear=True):
            with self.assertRaisesRegex(RuntimeError,'selected Git installation'):hw.git_environment()
        with patch.dict(os.environ,self.env,clear=True),patch.object(hw.subprocess,'run',side_effect=subprocess.CalledProcessError(1,['git'],stderr='private-marker')):
            with self.assertRaises(RuntimeError) as error:hw.git_environment()
        self.assertNotIn('private-marker',str(error.exception))

    def test_clone_and_revision_check_receive_the_recovered_environment(self):
        source=self.root/'.local/hardware/ctags-source'
        commit='abc8fca7499f44c725122881cd380a88c37abe0e'
        calls=[]
        def run(command,log,**kwargs):
            calls.append((command,kwargs))
            if command[0]=='git':source.mkdir(parents=True)
            else:(source/'ctags').write_bytes(b'owned fixture binary')
        with patch.dict(os.environ,self.env,clear=True),patch.object(hw,'ROOT',self.root),patch.object(hw,'run',side_effect=run), \
             patch.object(hw.subprocess,'check_output',return_value=commit+'\n') as revision:
            hw.native_ctags()
        self.assertEqual(calls[0][0][:2],['git','clone'])
        self.assertEqual(calls[0][1]['env']['GIT_EXEC_PATH'],str(self.helpers))
        self.assertEqual(revision.call_args.kwargs['env'],calls[0][1]['env'])

    def test_recovered_environment_dispatches_real_git_https_helper_without_network(self):
        # Git itself dispatches an owned no-network remote helper. The wrapper
        # models an executable relocated by a desktop host whose MCP env loses
        # GIT_EXEC_PATH; no globally installed Git/configuration is changed.
        real=shutil.which('git')
        if real is None:self.skipTest('Existing Git is required')
        self.git.write_text('#!'+sys.executable+'\nimport os,sys\n'
            'os.environ.setdefault("GIT_EXEC_PATH", "/missing-relocated-git/libexec/git-core")\n'
            'os.execv('+repr(real)+', ['+repr(real)+', *sys.argv[1:]])\n')
        self.helper.write_text('#!'+sys.executable+'\nprint("owned HTTPS helper dispatched")\n')
        broken=subprocess.run([str(self.git),'remote-https'],env=self.env,stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=5)
        self.assertNotEqual(broken.returncode,0)
        with patch.dict(os.environ,self.env,clear=True):env=hw.git_environment()
        fixed=subprocess.run([str(self.git),'remote-https'],env=env,stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=5,check=True)
        self.assertEqual(fixed.stdout.strip(),'owned HTTPS helper dispatched')

    def test_run_forwards_environment_without_mutating_process_environment(self):
        env={**os.environ,'M5_SETUP_FIXTURE':'child value'}
        before=os.environ.get('M5_SETUP_FIXTURE')
        result=hw.run([sys.executable,'-c','import os;print(os.environ["M5_SETUP_FIXTURE"])'],self.root/'run.log',env=env)
        self.assertEqual(result.strip(),'child value')
        self.assertEqual(os.environ.get('M5_SETUP_FIXTURE'),before)


if __name__=='__main__':unittest.main()
