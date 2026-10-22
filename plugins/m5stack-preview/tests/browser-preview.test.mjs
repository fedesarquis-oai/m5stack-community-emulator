import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {startBrowserPreview} from '../server/browser-preview-server.mjs';

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'm5-browser-test-'));
  await fs.mkdir(path.join(root, 'dist'));
  await fs.writeFile(path.join(root, 'browser-host.html'), '<style>body{margin:0}</style>');
  await fs.writeFile(path.join(root, 'speech-host.html'), '<style>body{margin:0}</style><p>Speech sample</p>');
  await fs.writeFile(path.join(root, 'dist/browser-host.js'), '/* synthetic */');
  await fs.writeFile(path.join(root, 'dist/workbench.html'), '<script type="module">/* synthetic */</script>');
  const calls = []; let closes = 0;
  const backend = {async open(args) { calls.push({open: args}); return {structuredContent: {sessionId: 'initial', status: 'running'}}; },
    async call(value) { calls.push(value); return {structuredContent: {sessionId: value.name === 'm5stack_reload' ? 'replacement' : value.arguments.sessionId, status: 'running'}}; },
    async close() { closes++; }};
  const preview = await startBrowserPreview({backend, uiRoot: root, openArguments: {workspace: '/fixed/workspace', profile: 'cores3se'}, ...options});
  t.after(async () => { await preview.close(); await fs.rm(root, {recursive: true, force: true}); });
  const token = new URL(preview.url).hash.slice(1);
  const request = (route = '/api/tool', body = {name: 'm5stack_frame', arguments: {sessionId: 'initial'}}, headers = {}) => fetch(preview.origin + route, {
    method: body ? 'POST' : 'GET', headers: {'X-M5-Preview-Token': token, ...(body ? {'Origin': preview.origin, 'Content-Type': 'application/json'} : {}), ...headers},
    ...(body ? {body: JSON.stringify(body)} : {}),
  });
  return {...preview, calls, request, token, backend, closes: () => closes};
}
test('browser host serves exact UI under isolated CSP and keeps capability in fragment', async t => {
  const f = await fixture(t);
  assert.equal(new URL(f.url).search, ''); assert.equal(f.token.length, 64);
  const ui = await fetch(f.origin + '/workbench.html');
  assert.equal(await ui.text(), '<script type="module">/* synthetic */</script>');
  assert.match(ui.headers.get('Content-Security-Policy'), /script-src 'sha256-[^']+' blob:/);
  assert.match(ui.headers.get('Content-Security-Policy'), /connect-src 'none'/);
  assert.match(ui.headers.get('Permissions-Policy'), /microphone=\(self\)/);
  assert.equal(ui.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(ui.headers.get('Cache-Control'), 'no-store');
  assert.equal((await f.request('/api/bootstrap', null)).status, 200);
  assert.equal((await fetch(f.origin + '/api/bootstrap')).status, 403);
  assert.deepEqual(f.calls, [{open: {workspace: '/fixed/workspace', profile: 'cores3se'}}]);
});
test('token, Host, Origin and Fetch Metadata checks reject cross-origin and rebinding attempts', async t => {
  const f = await fixture(t);
  for (const headers of [ {'X-M5-Preview-Token': 'wrong'}, {Origin: 'https://attacker.invalid'}, {'Sec-Fetch-Site': 'cross-site'}, {Origin: 'null'}, {Origin: ''} ]) {
    assert.equal((await f.request(undefined, undefined, headers)).status, 403, JSON.stringify(headers));
  }
  const hostileHost = await new Promise((resolve, reject) => {
    const request = http.get(f.origin + '/', {headers: {Host: 'attacker.invalid'}}, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
  });
  assert.equal(hostileHost, 403);
  assert.equal(f.calls.length, 1);
  assert.equal((await f.request('/api/bootstrap', null, {Origin: 'https://attacker.invalid'})).status, 403);
  assert.equal((await fetch(f.origin + '/../server/application-server.mjs')).status, 403);
});
test('only current-session browser tools cross the existing validated MCP boundary', async t => {
  const f = await fixture(t);
  for (const name of ['m5stack_open', 'm5stack_build', 'm5stack_import_image', 'm5stack_voice_submit', 'm5stack_voice_prepare', 'm5stack_voice_lookup', 'resources/read']) {
    assert.equal((await f.request('/api/tool', {name, arguments: {sessionId: 'initial', workspace: '/other'}})).status, 403);
  }
  const extra = await f.request('/api/tool', {name: 'm5stack_frame', arguments: {sessionId: 'initial'}, unexpected: true});
  assert.equal(extra.status, 403);
  const stale = await (await f.request('/api/tool', {name: 'm5stack_frame', arguments: {sessionId: 'unrelated'}})).json();
  assert.equal(stale.isError, true); assert.equal(f.calls.length, 1);
  const result = await (await f.request()).json();
  assert.equal(result.structuredContent.sessionId, 'initial'); assert.equal(f.calls.length, 2);
});
test('reload replaces session authority; stale frames and inputs cannot reach new worker', async t => {
  const f = await fixture(t);
  const reloaded = await (await f.request('/api/tool', {name: 'm5stack_reload', arguments: {sessionId: 'initial'}})).json();
  assert.equal(reloaded.structuredContent.sessionId, 'replacement');
  assert.equal((await (await f.request()).json()).isError, true);
  assert.equal(f.calls.length, 2);
  const bootstrap = await (await f.request('/api/bootstrap', null)).json();
  assert.equal(bootstrap.result.structuredContent.sessionId, 'replacement');
  await f.request('/api/tool', {name: 'm5stack_stop', arguments: {sessionId: 'replacement'}});
  assert.equal((await (await f.request('/api/tool', {name: 'm5stack_frame', arguments: {sessionId: 'replacement'}})).json()).isError, true);
});
test('requests queued behind reload recheck session after replacement completes', async t => {
  const f = await fixture(t);
  let release, entered;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  const releasePromise = new Promise(resolve => { release = resolve; });
  const call = f.backend.call;
  f.backend.call = async value => { if (value.name === 'm5stack_reload') { entered(); await releasePromise; } return call(value); };
  const reload = f.request('/api/tool', {name: 'm5stack_reload', arguments: {sessionId: 'initial'}});
  await enteredPromise;
  const stale = f.request();
  await new Promise(resolve => setTimeout(resolve, 20));
  release(); await reload;
  assert.equal((await (await stale).json()).isError, true);
  assert.equal(f.calls.filter(value => value.name === 'm5stack_frame').length, 0);
});
test('page refresh during reload waits for the current worker before bootstrapping', async t => {
  const f = await fixture(t);
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const call = f.backend.call;
  f.backend.call = async value => {
    if (value.name === 'm5stack_reload') { entered(); await gate; }
    return call(value);
  };
  const reload = f.request('/api/tool', {name: 'm5stack_reload', arguments: {sessionId: 'initial'}});
  await started;
  const bootstrap = f.request('/api/bootstrap', null).then(response => response.json());
  try {
    assert.equal(await Promise.race([bootstrap.then(() => 'stale bootstrap'), new Promise(resolve => setTimeout(() => resolve('waiting'), 30))]), 'waiting');
  } finally { release(); }
  await reload;
  const current = await bootstrap;
  assert.equal(current.result.structuredContent.sessionId, 'replacement');
  const frame = await (await f.request('/api/tool', {name: 'm5stack_frame', arguments: {sessionId: current.result.structuredContent.sessionId}})).json();
  assert.equal(frame.structuredContent.status, 'running');
});
test('oversized and non-JSON requests never reach native tools', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/tool', {name: 'm5stack_input', arguments: {sessionId: 'initial', text: 'x'.repeat(256 * 1024)}})).status, 400);
  assert.equal((await f.request(undefined, undefined, {'Content-Type': 'text/plain'})).status, 400);
  assert.equal(f.calls.length, 1);
});
test('explicit close is idempotent and closes the owned backend/listener', async t => {
  const f = await fixture(t);
  await Promise.all([f.close(), f.close()]);
  assert.equal(f.closes(), 1); assert.equal(f.server.listening, false);
});
test('session expires within its bounded lifetime', async t => {
  const f = await fixture(t, {lifetimeMs: 30});
  await new Promise(resolve => setTimeout(resolve, 70));
  assert.equal(f.closes(), 1); assert.equal(f.server.listening, false);
});
test('microphone ack is app-only transport data and never replaces frame bootstrap',async t=>{
  const f=await fixture(t),original=await (await f.request('/api/bootstrap',null)).json();
  f.backend.call=async value=>({content:[{type:'text',text:'Microphone operation acknowledged.'}],structuredContent:{sessionId:'initial',streamId:'stream',action:value.arguments.action,accepted:true,sequence:-1,nextFrame:0,requested:true,active:true}});
  const result=await (await f.request('/api/tool',{name:'m5stack_audio',arguments:{sessionId:'initial',streamId:'stream',action:'start',source:'browser'}})).json();
  assert.equal(result.structuredContent.accepted,true);assert.deepEqual(await (await f.request('/api/bootstrap',null)).json(),original);
  const rejected=await (await f.request('/api/tool',{name:'m5stack_audio',arguments:{sessionId:'old',streamId:'stream',action:'stop'}})).json();assert.equal(rejected.isError,true);
});
test('audio HTTP is singleflight while independent frame calls still complete',async t=>{
  const f=await fixture(t);let release,entered;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve),base=f.backend.call;
  f.backend.call=async value=>{if(value.name==='m5stack_audio'){entered();await gate;return {structuredContent:{sessionId:'initial',action:'start',accepted:true}};}return base(value);};
  const args={name:'m5stack_audio',arguments:{sessionId:'initial',streamId:'stream',action:'start',source:'browser'}};
  const first=f.request('/api/tool',args);await started;
  assert.equal((await f.request('/api/tool',args)).status,429);
  const frame=await f.request();assert.equal(frame.status,200);assert.equal((await frame.json()).structuredContent.status,'running');
  release();assert.equal((await first).status,200);
});
test('ordinary preview exposes no speech provider routes',async t=>{
  const f=await fixture(t);
  assert.equal((await f.request('/api/speech/status',null)).status,404);
  assert.equal((await f.request('/api/speech/transcribe',{clipId:'take',confirm:true})).status,404);
});
test('every app uses the same host; lifecycle can cancel services but cannot submit speech',async t=>{
  const f=await fixture(t);let suspended=0;f.backend.suspend=()=>{suspended++;};
  assert.doesNotMatch(await (await fetch(f.origin)).text(),/Speech sample/);
  assert.equal((await f.request('/api/lifecycle',{state:'hidden'})).status,200);
  assert.equal(suspended,1);
  assert.equal((await f.request('/api/lifecycle',{state:'hidden',clipId:'x'})).status,400);
  assert.equal((await f.request('/api/lifecycle',{state:'visible'})).status,400);
  assert.equal((await f.request('/api/lifecycle',{state:'hidden'},{Origin:''})).status,403);
  assert.equal((await f.request('/api/speech/transcribe',{clipId:'take',confirm:true})).status,404);
});
