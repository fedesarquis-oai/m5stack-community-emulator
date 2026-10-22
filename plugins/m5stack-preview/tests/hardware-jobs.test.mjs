import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {createHardwareRunner,backupProgress} from '../server/hardware.mjs';

async function fixture(t,script){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'m5-hardware-job-'));
  await fs.mkdir(path.join(root,'scripts'));
  await fs.writeFile(path.join(root,'scripts/hardware.py'),script);
  // Exercise the real workspace boundary and real subprocess, without USB.
  await fs.mkdir(path.join(root,'src'));
  for(const name of ['m5preview','dependencies.lock.json','src/virtual_device.cpp'])await fs.writeFile(path.join(root,name),'');
  t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;
}
async function completed(runner,root,id){
  for(let i=0;i<80;i++){
    const result=await runner.hardware({workspace:root,action:'status',operationId:id});
    if(result.structuredContent.status!=='running')return result;
    await sleep(25);
  }
  assert.fail('Background child did not complete');
}

test('long backup yields, reports progress and returns one retained result without rerunning',async t=>{
  const root=await fixture(t,`from pathlib import Path
import time,json
p=Path('.hardware-backups/20261020-120000');p.mkdir(parents=True)
Path('runs').open('a').write('run\\n')
(p/'read.log').write_text('private-data-not-for-output 4096 (42 %)')
time.sleep(.35)
(p/'verify.log').write_text('private-data-not-for-output')
time.sleep(.2)
print(json.dumps({'status':'backup_verified','private':True}))
`);
  const runner=createHardwareRunner({waitMs:30});t.after(runner.stopHardware);
  const first=await runner.hardware({workspace:root,action:'backup',profile:'cores3se'});
  assert.equal(first.structuredContent.status,'running');const id=first.structuredContent.operationId;
  assert.match(id,/^[0-9a-f-]{36}$/);
  await sleep(100);
  const active=await runner.hardware({workspace:root,action:'status',operationId:id});
  assert.deepEqual(active.structuredContent.progress,{phase:'reading-backup',percent:42});
  await assert.rejects(runner.hardware({workspace:root,action:'install'}),/already running/);
  const final=await completed(runner,root,id);
  assert.equal(final.structuredContent.status,'backup_verified');assert.equal(final.structuredContent.operationId,id);
  assert.deepEqual(await runner.hardware({workspace:root,action:'status',operationId:id}),final);
  assert.equal(await fs.readFile(path.join(root,'runs'),'utf8'),'run\n');
  assert.ok(!JSON.stringify([first,active,final]).includes('private-data-not-for-output'));
});

test('status is workspace-bound and cannot start a process after a server restart',async t=>{
  const a=await fixture(t,'import json\nprint(json.dumps({"status":"ok"}))');
  const b=await fixture(t,'raise Exception("must not execute")');
  const runner=createHardwareRunner({waitMs:1000});t.after(runner.stopHardware);
  const first=await runner.hardware({workspace:a,action:'devices'});
  await assert.rejects(runner.hardware({workspace:b,action:'status',operationId:first.structuredContent.operationId}),/unknown or expired/);
  const restarted=createHardwareRunner();t.after(restarted.stopHardware);
  await assert.rejects(restarted.hardware({workspace:a,action:'status',operationId:first.structuredContent.operationId}),/no operation was started/);
});

test('concurrent requests cannot start two operations on one workspace or USB identity',async t=>{
  const a=await fixture(t,'import time,json\ntime.sleep(.4)\nprint(json.dumps({"status":"ok"}))');
  const b=await fixture(t,'raise Exception("must not execute")');
  const runner=createHardwareRunner({waitMs:30});t.after(runner.stopHardware);
  const args={workspace:a,action:'backup',serial:'80:45:6B:4E:1B:48'};
  const results=await Promise.allSettled([runner.hardware(args),runner.hardware(args)]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  await assert.rejects(runner.hardware({...args,workspace:b,serial:args.serial.toLowerCase()}),/already running/);
  await completed(runner,a,results.find(x=>x.status==='fulfilled').value.structuredContent.operationId);
});

test('background failure is retained, stderr stays private and next work is unblocked',async t=>{
  const root=await fixture(t,'import sys,time,json\ntime.sleep(.15)\nsys.stderr.write("secret-marker")\nprint(json.dumps({"status":"error","message":"safe failure"}))\nsys.exit(1)');
  const runner=createHardwareRunner({waitMs:30});t.after(runner.stopHardware);
  const start=await runner.hardware({workspace:root,action:'build'});
  const final=await completed(runner,root,start.structuredContent.operationId);
  assert.equal(final.isError,true);assert.equal(final.structuredContent.message,'safe failure');
  assert.ok(!JSON.stringify(final).includes('secret-marker'));
  await fs.writeFile(path.join(root,'scripts/hardware.py'),'print("{}")');
  const next=await runner.hardware({workspace:root,action:'devices'});
  const done=next.structuredContent.status==='running'?await completed(runner,root,next.structuredContent.operationId):next;
  assert.ok(!done.isError);
});

test('shutdown stops pending work and rejects new work; malformed output is not success',async t=>{
  const root=await fixture(t,'import time\ntime.sleep(10)\nprint("{}")');
  const runner=createHardwareRunner({waitMs:30});t.after(runner.stopHardware);
  const start=await runner.hardware({workspace:root,action:'build'});await runner.stopHardware();
  const final=await completed(runner,root,start.structuredContent.operationId);assert.equal(final.isError,true);
  await assert.rejects(runner.hardware({workspace:root,action:'build'}),/stopping/);
});

test('progress cannot claim overall completion or read a linked log',async t=>{
  const root=await fixture(t,'print("{}")');
  const folder=path.join(root,'.hardware-backups/20261020-120000');await fs.mkdir(folder,{recursive:true});
  await fs.writeFile(path.join(folder,'read.log'),'16777216 (100 %)');
  assert.deepEqual(await backupProgress(root,Date.now()),{phase:'reading-backup',percent:100});
  await fs.writeFile(path.join(folder,'verify.log'),'secret');
  assert.deepEqual(await backupProgress(root,Date.now()),{phase:'verifying-backup'});
  await fs.unlink(path.join(folder,'verify.log'));await fs.unlink(path.join(folder,'read.log'));
  await fs.symlink(path.join(root,'scripts/hardware.py'),path.join(folder,'read.log'));
  assert.equal(await backupProgress(root,Date.now()),null);
});
