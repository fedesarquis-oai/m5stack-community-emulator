import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const launcher=fileURLToPath(new URL('../server/launch.sh',import.meta.url));

// Copy only the launcher into an owned fixture. Repoint its fixed application
// roots so discovery can be exercised without touching installed applications.
async function launchFixture(t) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'m5 launcher '));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const plugin=path.join(directory,'plugin with spaces'), bin=path.join(directory,'bin');
  const apps=path.join(directory,'Applications'), log=path.join(directory,'calls.txt');
  await mkdir(path.join(plugin,'server','dist'),{recursive:true});
  await mkdir(bin);
  await symlink('/usr/bin/dirname',path.join(bin,'dirname'));
  const source=(await readFile(launcher,'utf8')).replaceAll('/Applications/',apps+'/');
  const fixtureLauncher=path.join(plugin,'server','launch.sh');
  await writeFile(fixtureLauncher,source,{mode:0o755});
  for(const entrypoint of ['index.js','browser-preview.js'])await writeFile(path.join(plugin,'server','dist',entrypoint),'// fixture only\n');
  return {
    plugin,bin,apps,log,
    async node(executable,{label='selected',version='v22.0.0',versionExit=0,runExit=0}={}) {
      await mkdir(path.dirname(executable),{recursive:true});
      await writeFile(executable,`#!/bin/sh\nprintf '%s\\n' 'CALL ${label}' "$@" >> "$M5_LAUNCHER_TEST_LOG"\nif [ "$1" = --version ]; then\n  printf '%s\\n' '${version}'\n  exit ${versionExit}\nfi\nexit ${runExit}\n`,{mode:0o755});
    },
    run(args=[]) {
      return spawnSync('/bin/sh',[fixtureLauncher,...args],{encoding:'utf8',timeout:3000,
        env:{...process.env,PATH:bin,M5_LAUNCHER_TEST_LOG:log}});
    },
    async calls() { return (await readFile(log,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;})).trim().split('\n').filter(Boolean); },
  };
}

test('launcher: default MCP entrypoint and browser arguments use the same selected runtime',async t=>{
  const fixture=await launchFixture(t);
  await fixture.node(path.join(fixture.bin,'node'));
  const normal=fixture.run();
  assert.equal(normal.error,undefined);
  assert.equal(normal.status,0);
  assert.equal(normal.stdout,'');
  assert.equal(normal.stderr,'');
  const workspace=path.join(fixture.plugin,"user's app with spaces");
  const args=['--workspace',workspace,'--profile','cores3se','--app','custom'];
  const browser=fixture.run(['--browser',...args]);
  assert.equal(browser.error,undefined);
  assert.equal(browser.status,0);
  assert.equal(browser.stdout,'');
  assert.equal(browser.stderr,'');
  assert.deepEqual(await fixture.calls(),[
    'CALL selected','--version','CALL selected',path.join(fixture.plugin,'server','dist','index.js'),
    'CALL selected','--version','CALL selected',path.join(fixture.plugin,'server','dist','browser-preview.js'),...args,
  ]);
});

for(const app of ['Codex.app','Codex (Nightly).app','Codex (Alpha).app','ChatGPT.app','ChatGPT (Nightly).app','ChatGPT (Alpha).app']) {
  test(`launcher: discovers an executable ${app} runtime when PATH has no Node`,async t=>{
    const fixture=await launchFixture(t);
    await fixture.node(path.join(fixture.apps,app,'Contents','Resources','cua_node','bin','node'));
    const result=fixture.run(['--browser']);
    assert.equal(result.error,undefined);
    assert.equal(result.status,0);
    assert.equal(result.stderr,'');
    assert.deepEqual(await fixture.calls(),['CALL selected','--version','CALL selected',path.join(fixture.plugin,'server','dist','browser-preview.js')]);
  });
}

test('launcher: ignores a nonexecutable bundle and preserves PATH runtime precedence',async t=>{
  const fixture=await launchFixture(t);
  const unavailable=path.join(fixture.apps,'Codex.app','Contents','Resources','cua_node','bin','node');
  await mkdir(path.dirname(unavailable),{recursive:true});
  await writeFile(unavailable,'not executable\n',{mode:0o644});
  await fixture.node(path.join(fixture.apps,'ChatGPT.app','Contents','Resources','cua_node','bin','node'),{label:'bundle'});
  assert.equal(fixture.run().status,0);
  await fixture.node(path.join(fixture.bin,'node'),{label:'PATH'});
  assert.equal(fixture.run().status,0);
  assert.deepEqual(await fixture.calls(),[
    'CALL bundle','--version','CALL bundle',path.join(fixture.plugin,'server','dist','index.js'),
    'CALL PATH','--version','CALL PATH',path.join(fixture.plugin,'server','dist','index.js'),
  ]);
});

for(const args of [['--unknown'],['--browser','--unknown'],['--browser','--workspace'],['--browser','--app','']]) {
  test(`launcher: rejects unsupported or incomplete arguments ${JSON.stringify(args)} before runtime execution`,async t=>{
    const fixture=await launchFixture(t);
    await fixture.node(path.join(fixture.bin,'node'));
    const result=fixture.run(args);
    assert.equal(result.error,undefined);
    assert.equal(result.status,2);
    assert.match(result.stderr,/Usage: launch\.sh/);
    assert.deepEqual(await fixture.calls(),[]);
  });
}

test('launcher: missing runtime fails clearly without starting anything',async t=>{
  const fixture=await launchFixture(t);
  const result=fixture.run(['--browser']);
  assert.equal(result.error,undefined);
  assert.equal(result.status,1);
  assert.match(result.stderr,/needs an approved Node 22\+ runtime/);
  assert.deepEqual(await fixture.calls(),[]);
});

for(const [mode,versionExit,runExit] of [[[],23,0],[['--browser'],0,29]]) {
  test(`launcher: selected runtime failure is terminal for ${mode.length?'browser':'MCP'}`,async t=>{
    const fixture=await launchFixture(t);
    await fixture.node(path.join(fixture.bin,'node'),{label:'PATH',versionExit,runExit});
    await fixture.node(path.join(fixture.apps,'Codex.app','Contents','Resources','cua_node','bin','node'),{label:'fallback'});
    const result=fixture.run(mode);
    assert.equal(result.error,undefined);
    assert.equal(result.status,versionExit||runExit);
    assert.ok(!(await fixture.calls()).includes('CALL fallback'));
    assert.deepEqual(await fixture.calls(),versionExit?['CALL PATH','--version']:[
      'CALL PATH','--version','CALL PATH',path.join(fixture.plugin,'server','dist','browser-preview.js'),
    ]);
  });
}

test('launcher: browser mode requires its own built entrypoint',async t=>{
  const fixture=await launchFixture(t);
  await fixture.node(path.join(fixture.bin,'node'));
  await rm(path.join(fixture.plugin,'server','dist','browser-preview.js'));
  const result=fixture.run(['--browser']);
  assert.equal(result.error,undefined);
  assert.equal(result.status,1);
  assert.match(result.stderr,/unbuilt source candidate/);
  assert.deepEqual(await fixture.calls(),['CALL selected','--version']);
});

for(const [name,version,exitCode,message] of [
  ['old runtime','v18.20.0',0,/needs Node 22 or newer; selected v18\.20\.0/],
  ['unrecognized runtime','unrecognized',0,/could not identify/],
  ['selected executable fails','',23,null],
])test(`launcher: ${name} fails before server start and never selects another executable`,async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'m5-launcher-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  await writeFile(path.join(directory,'node'),`#!/bin/sh\nprintf '%s\\n' "$*" >> "$M5_LAUNCHER_TEST_LOG"\nif [ "$1" = --version ]; then\n  printf '%s\\n' '${version}'\n  exit ${exitCode}\nfi\nexit 99\n`,{mode:0o755});
  const log=path.join(directory,'calls.txt');
  const result=spawnSync('sh',[launcher],{encoding:'utf8',timeout:3000,
    env:{...process.env,PATH:directory+path.delimiter+(process.env.PATH??''),M5_LAUNCHER_TEST_LOG:log}});
  assert.equal(result.error,undefined);
  assert.equal(result.status,exitCode||1);
  assert.equal(result.stdout,'');
  if(message)assert.match(result.stderr,message);
  assert.equal(await readFile(log,'utf8'),'--version\n');
});
