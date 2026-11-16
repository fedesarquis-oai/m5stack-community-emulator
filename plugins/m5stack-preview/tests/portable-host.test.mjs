import test from 'node:test';
import assert from 'node:assert/strict';
import {launchArguments} from '../server/launch.mjs';
import {executableCandidates} from '../server/host-tools.mjs';

test('portable launcher preserves workspace values and rejects malformed options before startup',()=>{
  const args=['--browser','--workspace','C:\\Users\\Builder Name\\my app','--profile','cores3','--app','custom'];
  assert.deepEqual(launchArguments(args,'22.0.0'),{entry:'browser-preview.js',options:args.slice(1)});
  assert.equal(launchArguments([],'24.1.0').entry,'index.js');
  for(const invalid of [['--workspace','x'],['--browser','--workspace'],['--browser','--profile','cores3','--profile','cores3se'],['--browser','--run','anything']])
    assert.throws(()=>launchArguments(invalid,'22.0.0'));
  for(const version of ['20.1.0','unknown','v22.0.0'])assert.throws(()=>launchArguments([],version),/Node 22/);
});
test('Windows discovery uses native executable suffixes without shell expansion or relative PATH entries',()=>{
  const list=executableCandidates('python',{platform:'win32',searchPath:'C:\\Python312;relative;"C:\\Program Files\\Python"'});
  assert.deepEqual(list,['C:\\Python312\\python.exe','C:\\Python312\\python','C:\\Program Files\\Python\\python.exe','C:\\Program Files\\Python\\python']);
  assert.deepEqual(executableCandidates('clang++',{platform:'linux',searchPath:'/usr/bin:.:/opt/tools'}),['/usr/bin/clang++','/opt/tools/clang++']);
});

