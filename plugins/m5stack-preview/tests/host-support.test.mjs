import test from 'node:test';
import assert from 'node:assert/strict';
import {hostSupport} from '../server/host-support.mjs';
import {doctor} from '../server/workbench.mjs';

test('host evidence and firmware installer availability remain distinct',()=>{
  assert.equal(hostSupport('darwin','arm64').browserEndToEndValidated,true);
  assert.equal(hostSupport('darwin','x64').browserEndToEndValidated,false);
  assert.equal(hostSupport('darwin','x64').automaticFirmwareSetupSupported,true);
  for(const [platform,arch] of [['linux','x64'],['linux','arm64'],['win32','x64'],['win32','arm64']]){
    const status=hostSupport(platform,arch);
    assert.equal(status.browserEndToEndValidated,false);
    assert.equal(status.automaticFirmwareSetupSupported,platform==='linux'||arch==='x64');
    assert.equal(status.nativeWindowsLauncherSupported,true);
    assert.equal(status.posixShellRequired,false);
  }
});
test('doctor reports the current host limits without a workspace or hardware access',async()=>{
  const result=(await doctor()).structuredContent;
  assert.deepEqual(result.hostSupport,hostSupport(process.platform,process.arch));
  assert.equal(result.workspacePrepared,false);
  assert.equal(result.hardwareAccess,false);
});
