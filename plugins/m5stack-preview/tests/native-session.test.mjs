import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { NativeSession, encodeNativePng, sourceDigest } from '../server/native-session.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_BUILD = process.env.M5_REVIEW_BUILD ?? path.join(PACKAGE_ROOT, 'runtime/.build/virtual-device');
const SOURCE_ROOT = path.resolve(SOURCE_BUILD, '../..');
const hash = data => createHash('sha256').update(data).digest('hex');
const names = { atoms3r: 'build-atoms3r.json', stickcplus2: 'build.json', cores3: 'build-cores3.json', cores3se:'build-cores3se.json',sticks3:'build-sticks3.json' };
async function isolated(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'm5-node-review-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const build = path.join(root, '.build/virtual-device'); await fs.mkdir(build, { recursive: true });
  return { root, build };
}
async function prepared(t, profileId) {
  const { root, build } = await isolated(t);
  for (const relative of ['src', 'data']) await fs.cp(path.join(SOURCE_ROOT, relative), path.join(root, relative), { recursive: true });
  for (const relative of ['dependencies.lock.json', 'scripts/virtual_device.py', 'vendor/M5GFX/src/lgfx/Fonts/glcdfont.h']) {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true }); await fs.copyFile(path.join(SOURCE_ROOT, relative), path.join(root, relative));
  }
  const meta = JSON.parse(await fs.readFile(path.join(SOURCE_BUILD, names[profileId]), 'utf8'));
  await fs.copyFile(path.join(SOURCE_BUILD, meta.binary), path.join(build, meta.binary));
  await fs.writeFile(path.join(build, names[profileId]), JSON.stringify(meta));
  return { root, build, meta };
}
async function fake(t, source, changes = {}) {
  const { root, build } = await isolated(t), binary = 'worker-fixture';
  const profileId=changes.profile??'atoms3r';
  for (const directory of ['src', 'data', 'scripts', 'vendor/M5GFX/src/lgfx/Fonts']) await fs.mkdir(path.join(root, directory), { recursive: true });
  for (const relative of ['dependencies.lock.json', 'scripts/eightball_shared.py', 'scripts/virtual_device.py', 'scripts/wav_fixture.py', 'vendor/M5GFX/src/lgfx/Fonts/glcdfont.h']) await fs.writeFile(path.join(root, relative), 'fixture only\n');
  await fs.writeFile(path.join(build, binary), '#!/bin/sh\n'+source, { mode: 0o700 });
  const meta = { build_id: 'fixture', source_sha256: await sourceDigest(root, profileId), binary, binary_sha256: hash(await fs.readFile(path.join(build, binary))), profile: profileId, width: 128, height: 128, ...changes };
  await fs.writeFile(path.join(build, names[profileId]), JSON.stringify(meta));
  return { root, build, meta };
}
function decode(png) {
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137,80,78,71,13,10,26,10]));
  let offset = 8, width, height, compressed = [];
  while (offset < png.length) {
    const size = png.readUInt32BE(offset), type = png.toString('ascii', offset+4, offset+8), content = png.subarray(offset+8, offset+8+size);
    if (type === 'IHDR') { width = content.readUInt32BE(); height = content.readUInt32BE(4); assert.equal(content[8], 8); assert.equal(content[9], 2); }
    if (type === 'IDAT') compressed.push(content);
    offset += size + 12;
  }
  const rows = inflateSync(Buffer.concat(compressed)), rgb = Buffer.alloc(width*height*3);
  for (let y=0;y<height;y++) { assert.equal(rows[y*(width*3+1)],0); rows.copy(rgb,y*width*3,y*(width*3+1)+1,(y+1)*(width*3+1)); }
  return { width, height, rgb };
}
const press = (s, id, durationMs = 30, coords = {}) => s.input({ sessionId: s.sessionId, requestId: id, event: { type: 'primary', durationMs, ...coords } });

test('PNG contains exactly the supplied native RGB bytes', () => {
  const rgb = Buffer.from([255,0,0,0,255,0,0,0,255,90,80,70]);
  assert.deepEqual(decode(encodeNativePng(rgb,2,2)).rgb, rgb);
  assert.throws(() => encodeNativePng(Buffer.alloc(1),2,2), { code:'INVALID_FRAME' });
});
for (const [profileId, dimensions] of Object.entries({atoms3r:[128,128],stickcplus2:[135,240],cores3:[320,240]})) {
  test(`real ${profileId}: C++ pixels, input, exact hold threshold, dedupe, reset`, async t => {
    const {root} = await prepared(t,profileId), s = await NativeSession.open({workspaceRoot:root,profileId,appId:'counter'}); t.after(()=>s.close());
    const initial=s.snapshot(), decoded=decode(initial.frame.png);
    assert.equal(initial.status,'running'); assert.deepEqual([decoded.width,decoded.height],dimensions);
    assert.equal(hash(decoded.rgb),initial.frame.rgbSha256); assert.equal(hash(initial.frame.png),initial.frame.sha256);
    assert.equal(initial.nativeState.title,'Hello, world!'); assert.equal(initial.nativeState.count,0); assert.equal(initial.nativeState.step,1);
    const stepped=await press(s,'first',999); assert.equal(stepped.nativeState.count,1); assert.notEqual(stepped.frame.sha256,initial.frame.sha256);
    const repeated=await press(s,'first',999); assert.equal(repeated.nativeState.count,1); assert.equal(repeated.revision,stepped.revision);
    await assert.rejects(press(s,'first',10),{code:'REQUEST_ID_REUSED'});
    await assert.rejects(s.input({sessionId:'old',requestId:'stale',event:{type:'reset'}}),{code:'STALE_SESSION'});
    await s.input({sessionId:s.sessionId,requestId:'tilt',event:{type:'tilt',degrees:30}});
    const tiltedPress=await press(s,'tilted-press'); assert.equal(tiltedPress.nativeState.count,2); assert.equal(tiltedPress.nativeState.step,1);
    const held=await press(s,'hold',1000); assert.equal(held.nativeState.count,0); assert.equal(held.frame.sha256,initial.frame.sha256);
    const shaken=await s.input({sessionId:s.sessionId,requestId:'shake',event:{type:'shake'}}); assert.equal(shaken.nativeState.count,0); assert.equal(shaken.nativeState.user_app.alternate,true);
    const reset=await s.input({sessionId:s.sessionId,requestId:'reset',event:{type:'reset'}});assert.equal(reset.nativeState.count,0);assert.equal(reset.frame.sha256,initial.frame.sha256);
    await assert.rejects(s.input({sessionId:s.sessionId,requestId:'bad',event:{type:'tilt',degrees:Infinity}}),{code:'INVALID_INPUT'});
    await assert.rejects(press(s,'coords',30,{x:dimensions[0],y:0}),{code:'INVALID_INPUT'});
    const oldPng=Buffer.from(s.snapshot().frame.png);const exposed=s.snapshot();exposed.frame.png.fill(0);assert.deepEqual(s.snapshot().frame.png,oldPng);
    await s.close(); assert.equal(s.snapshot().status,'stopped'); assert.notEqual(s._child.exitCode ?? s._child.signalCode,null);
    const reloaded=await NativeSession.open({workspaceRoot:root,profileId,appId:'counter'});t.after(()=>reloaded.close());
    assert.equal(reloaded.snapshot().nativeState.count,0);assert.equal(reloaded.snapshot().frame.sha256,initial.frame.sha256);
  });
}
test('retired experiments cannot launch as plugin apps',async t=>{
  const {root}=await prepared(t,'cores3');
  for(const appId of ['trail','eightball','mascot'])
    await assert.rejects(NativeSession.open({workspaceRoot:root,profileId:'cores3',appId}),{code:'UNSUPPORTED_APP'});
});
test('crash becomes exited, last frame stays available, input is not replayed',async t=>{
  const {root}=await prepared(t,'atoms3r');const s=await NativeSession.open({workspaceRoot:root,profileId:'atoms3r',appId:'counter'});t.after(()=>s.close());
  const hashBefore=s.snapshot().frame.sha256;await new Promise(resolve=>{s._child.once('exit',resolve);s._child.kill('SIGKILL');});
  assert.equal(s.snapshot().status,'exited');assert.equal(s.snapshot().frame.sha256,hashBefore);
  await assert.rejects(press(s,'after-crash'),{code:'NATIVE_EXITED'});
});
test('binary hash and root containment are enforced',async t=>{
  const a=await prepared(t,'atoms3r');await fs.appendFile(path.join(a.build,a.meta.binary),'tamper');
  await assert.rejects(NativeSession.open({workspaceRoot:a.root,profileId:'atoms3r',appId:'counter'}),{code:'BUILD_CHANGED'});
  const b=await prepared(t,'atoms3r');const outside=path.join(b.root,'outside-worker');await fs.rename(path.join(b.build,b.meta.binary),outside);await fs.symlink(outside,path.join(b.build,b.meta.binary));
  await assert.rejects(NativeSession.open({workspaceRoot:b.root,profileId:'atoms3r',appId:'counter'}),{code:'INVALID_BUILD'});
  const c=await prepared(t,'atoms3r');await fs.writeFile(path.join(c.build,names.atoms3r),'x'.repeat(16385));
  await assert.rejects(NativeSession.open({workspaceRoot:c.root,profileId:'atoms3r',appId:'counter'}),{code:'INVALID_BUILD'});
});
test('source digest matches build metadata, rejects edits and escaped source resources',async t=>{
  const a=await prepared(t,'atoms3r');assert.equal(await sourceDigest(a.root,'atoms3r'),a.meta.source_sha256);
  await fs.appendFile(path.join(a.root,'src/user_draw.hpp'),'\n// intentional review edit\n');
  await assert.rejects(NativeSession.open({workspaceRoot:a.root,profileId:'atoms3r',appId:'counter'}),{code:'STALE_BUILD'});
  const b=await prepared(t,'atoms3r'),outside=path.join(b.root,'../source-outside-'+path.basename(b.root));
  await fs.writeFile(outside,'outside fixture');t.after(()=>fs.rm(outside,{force:true}));await fs.unlink(path.join(b.root,'src/user_draw.hpp'));await fs.symlink(outside,path.join(b.root,'src/user_draw.hpp'));
  await assert.rejects(sourceDigest(b.root,'atoms3r'),{code:'INVALID_SOURCE'});
});
for (const profileId of ['atoms3r','stickcplus2','cores3']) test(`custom ${profileId}: editable alias uses the same starter`,async t=>{
  const {root}=await prepared(t,profileId);const s=await NativeSession.open({workspaceRoot:root,profileId,appId:'custom'});t.after(()=>s.close());
  const initial=s.snapshot();assert.equal(initial.nativeState.user_app.count,0);assert.equal(initial.app,'custom');assert.equal(initial.nativeState.title,'Hello, world!');
  const stepped=await press(s,'custom-step');assert.equal(stepped.nativeState.user_app.count,1);assert.notEqual(stepped.frame.sha256,initial.frame.sha256);
  const shaken=await s.input({sessionId:s.sessionId,requestId:'custom-shake',event:{type:'shake'}});assert.equal(shaken.nativeState.user_app.alternate,true);
  const tilted=await s.input({sessionId:s.sessionId,requestId:'custom-tilt',event:{type:'tilt',degrees:-30}});assert.equal(tilted.nativeState.user_app.tilt_degrees,-30);
  const held=await press(s,'custom-hold',1000);assert.equal(held.nativeState.user_app.count,0);assert.equal(held.nativeState.user_app.alternate,false);
  for(const type of ['mic','tone','page']) await assert.rejects(s.input({sessionId:s.sessionId,requestId:`custom-${type}`,event:{type}}),{code:'INVALID_INPUT'});
});
for(const [name,source,code] of [
  ['bad JSON',"printf 'not-json\\n'\n",'INVALID_HEADER'],
  ['wrong geometry',"printf '{\"profile\":\"atoms3r\",\"app\":\"counter\",\"width\":1,\"height\":128}\\n'\n",'INVALID_GEOMETRY'],
  ['oversized header',`printf '${'x'.repeat(8193)}'\n`,'INVALID_HEADER'],
  ['truncated frame',"printf '{\"profile\":\"atoms3r\",\"app\":\"counter\",\"width\":128,\"height\":128}\\nx'\n",'NATIVE_EXITED'],
  ['silent worker','exec /bin/sleep 30\n','NATIVE_TIMEOUT'],
]) test(`reject ${name} and close owned worker`,async t=>{
  const {root}=await fake(t,source);await assert.rejects(NativeSession.open({workspaceRoot:root,profileId:'atoms3r',appId:'counter',ioTimeoutMs:1500,closeTimeoutMs:500}),{code});
});
test('full native input pipe cannot block close; timed-out commands are not replayed',async t=>{
  const header=JSON.stringify({profile:'atoms3r',app:'counter',width:128,height:128});
  const {root}=await fake(t,`printf '${header}\\n'\nprintf '${'\\000'.repeat(128*128*3)}'\nexec /bin/sleep 30\n`);
  const s=await NativeSession.open({workspaceRoot:root,profileId:'atoms3r',appId:'counter',ioTimeoutMs:1500,closeTimeoutMs:500});t.after(()=>s.close());
  await assert.rejects(s._command(Buffer.alloc(192015)),{code:'NATIVE_TIMEOUT'});assert.equal(s.snapshot().status,'unavailable');
  const start=Date.now();await s.close();assert.ok(Date.now()-start<1200);assert.equal(s.snapshot().status,'stopped');assert.notEqual(s._child.exitCode??s._child.signalCode,null);
});
test('queued actions are bounded and closing cancels every owned pending action',async t=>{
  const {root}=await prepared(t,'cores3');const s=await NativeSession.open({workspaceRoot:root,profileId:'cores3',appId:'counter'});t.after(()=>s.close());
  const pending=Array.from({length:8},(_,i)=>press(s,`queued-${i}`));
  const observed=pending.map(result=>result.catch(error=>error));
  await assert.rejects(press(s,'overflow'),{code:'QUEUE_FULL'});
  await s.close();const outcomes=await Promise.all(observed);
  assert.ok(outcomes.every(value=>value instanceof Error || value.status==='running'));
  assert.equal(s.snapshot().status,'stopped');
  await assert.rejects(press(s,'closed'),{code:'SESSION_STOPPED'});
});
test('unsolicited trailing bytes invalidate the native stream',async t=>{
  const header=JSON.stringify({profile:'atoms3r',app:'counter',width:128,height:128});
  const {root}=await fake(t,`printf '${header}\\n${'\\000'.repeat(128*128*3)}x'\nexec /bin/sleep 30\n`);
  let session;
  try {
    session=await NativeSession.open({workspaceRoot:root,profileId:'atoms3r',appId:'counter',ioTimeoutMs:1500,closeTimeoutMs:500});
    // A read boundary may deliver the complete valid frame before its excess byte.
    await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(session.snapshot().status,'unavailable');
  } catch(error) { assert.ok(['UNSOLICITED_FRAME','INVALID_FRAME'].includes(error.code),error.message); }
  finally { if(session)await session.close(); }
});

for (const profileId of ['atoms3r','stickcplus2','cores3','cores3se']) {
  for (const appId of ['counter','custom']) test(`media v1 ${profileId}/${appId}: exact capabilities, normalized levels and reset`,async t=>{
    const {root}=await prepared(t,profileId),s=await NativeSession.open({workspaceRoot:root,profileId,appId});t.after(()=>s.close());
    const initial=s.snapshot(),cap=initial.capabilities,supported=profileId!=='atoms3r';
    assert.equal(initial.nativeState.media_adapter,1);assert.equal(cap.mediaAdapter,1);
    assert.equal(cap.microphone,supported);assert.equal(cap.microphoneMode,supported?'level':'none');
    assert.equal(cap.microphoneMapping,supported?'user-app':'none');
    assert.equal(cap.audioOutput,!supported?'none':profileId==='stickcplus2'?'buzzer':'speaker');
    assert.equal(cap.audioMode,cap.audioOutput==='none'?'none':cap.audioOutput==='speaker'?'pcm':'tone');
    const input=(requestId,event)=>s.input({sessionId:s.sessionId,requestId,event});
    if(!supported) {
      await assert.rejects(input('no-mic',{type:'mic',level:0.5,source:'fixture'}),{code:'UNSUPPORTED_INPUT'});
      assert.equal(s.snapshot().revision,initial.revision);return;
    }
    for (const [index,[source,level]] of [['fixture',0],['fixture',0.125],['browser',0.5],['browser',1]].entries()) {
      const next=await input('mic-'+index,{type:'mic',level,source});
      assert.equal(next.nativeState.mic_level,level*100);assert.equal(next.nativeState.mic_source,source);
      assert.equal(next.nativeState.count,0);
      {
        assert.equal(next.nativeState.user_app.microphone_amplitude,level);
        if(level===0)assert.equal(next.frame.sha256,initial.frame.sha256);
        else assert.notEqual(next.frame.sha256,initial.frame.sha256,'Nonzero input must draw the native meter');
        // Scalar media input changes the small native meter, never the counter,
        // title, controls, or app-owned PCM sample count. Compare every other row.
        const actual=decode(next.frame.png),baseline=decode(initial.frame.png);
        for(let y=0;y<actual.height;y++) {
          if(y>=actual.height-55 && y<actual.height-52)continue;
          const start=y*actual.width*3,end=start+actual.width*3;
          assert.deepEqual(actual.rgb.subarray(start,end),baseline.rgb.subarray(start,end),`Unexpected changed row ${y}`);
        }
        assert.equal(next.nativeState.audio_input.active,false);
        assert.equal(next.nativeState.audio_input.received_frames,0);
        assert.equal(next.nativeState.audio_input.next_frame,0);
      }
    }
    const before=s.snapshot().revision;
    const invalid=[{type:'mic',level:0.5},{type:'mic',level:0.5,source:'unknown'},{type:'mic',level:0.5,source:'browser',extra:true},
      ...[-0.01,1.01,NaN,Infinity,'0.5'].map(level=>({type:'mic',level,source:'fixture'}))];
    for (const [index,event] of invalid.entries())await assert.rejects(input('invalid-mic-'+index,event),{code:'INVALID_INPUT'});
    assert.equal(s.snapshot().revision,before);
    const reset=await input('media-reset',{type:'reset'});
    assert.equal(reset.nativeState.mic_level,0);assert.equal(reset.nativeState.app_sound,null);
    assert.equal(reset.nativeState.count,0);assert.equal(reset.frame.sha256,initial.frame.sha256);
    assert.equal(reset.nativeState.user_app.microphone_amplitude,0);
  });
}

test('legacy and unknown worker media contracts cannot enable microphone or forward sound',async t=>{
  for (const version of [undefined,2]) {
    const header={profile:'stickcplus2',app:'counter',width:135,height:240,app_sound:{id:1,frequency_hz:9000},...(version===undefined?{}:{media_adapter:version})};
    const {root}=await fake(t,`printf '${JSON.stringify(header)}\\n'\nprintf '${'\\000'.repeat(135*240*3)}'\nexec /bin/sleep 30\n`,{profile:'stickcplus2',width:135,height:240});
    const s=await NativeSession.open({workspaceRoot:root,profileId:'stickcplus2',appId:'counter',closeTimeoutMs:500});t.after(()=>s.close());
    assert.equal(s.snapshot().capabilities.microphone,false);assert.equal(s.snapshot().capabilities.audioOutput,'none');
    assert.equal(s.snapshot().nativeState.app_sound,null);
    await assert.rejects(s.input({sessionId:s.sessionId,requestId:'mic',event:{type:'mic',level:0.5,source:'fixture'}}),{code:'UNSUPPORTED_INPUT'});
  }
});

test('malformed or wrong-profile native media fails before publishing a frame',async t=>{
  const sound={id:1,origin:'app',cue:'test_click',frequency_hz:440,duration_ms:70,kind:'buzzer'};
  const badSounds=[{...sound,id:0},{...sound,id:Number.MAX_SAFE_INTEGER+1},{...sound,origin:'diagnostic'},
    {...sound,cue:'x'.repeat(65)},{...sound,cue:'<script>'},{...sound,frequency_hz:39},{...sound,frequency_hz:4001},
    {...sound,frequency_hz:440.5},{...sound,duration_ms:0},{...sound,duration_ms:1001},{...sound,kind:'speaker'},{...sound,extra:true}];
  const mutations=[...badSounds.map(app_sound=>({app_sound})),{mic_level:-1},{mic_level:101},{mic_level:'50'},{mic_source:'network'}];
  for(const mutation of mutations) {
    const header={profile:'stickcplus2',app:'counter',width:135,height:240,media_adapter:1,mic_level:0,mic_source:'fixture',app_sound:null,...mutation};
    const {root}=await fake(t,`printf '${JSON.stringify(header)}\\n'\nexec /bin/sleep 30\n`,{profile:'stickcplus2',width:135,height:240});
    await assert.rejects(NativeSession.open({workspaceRoot:root,profileId:'stickcplus2',appId:'counter',closeTimeoutMs:50}),{code:'INVALID_MEDIA'});
  }
  const header={profile:'atoms3r',app:'counter',width:128,height:128,media_adapter:1,mic_level:0,mic_source:'fixture',app_sound:{...sound,kind:'none'}};
  const {root}=await fake(t,`printf '${JSON.stringify(header)}\\n'\nexec /bin/sleep 30\n`);
  await assert.rejects(NativeSession.open({workspaceRoot:root,profileId:'atoms3r',appId:'counter',closeTimeoutMs:50}),{code:'INVALID_MEDIA'});
});

test('source-authored tone passes through actual worker with monotonic IDs and reset clearing', {skip:!process.env.M5_REVIEW_SOUND_WORKSPACE},async t=>{
  for(const profileId of ['atoms3r','stickcplus2','cores3']) {
    const s=await NativeSession.open({workspaceRoot:process.env.M5_REVIEW_SOUND_WORKSPACE,profileId,appId:'custom'});t.after(()=>s.close());
    const first=await press(s,'authored-first');
    if(profileId==='atoms3r'){assert.equal(first.nativeState.app_sound,null);continue;}
    const expected={id:1,origin:'app',cue:'user_click',frequency_hz:523,duration_ms:80,kind:profileId==='stickcplus2'?'buzzer':'speaker'};
    assert.deepEqual(first.nativeState.app_sound,expected);
    assert.deepEqual((await s.refresh()).nativeState.app_sound,expected);
    assert.equal((await press(s,'authored-second')).nativeState.app_sound.id,2);
    const reset=await s.input({sessionId:s.sessionId,requestId:'sound-reset',event:{type:'reset'}});assert.equal(reset.nativeState.app_sound,null);
    assert.equal((await press(s,'authored-third')).nativeState.app_sound.id,3);
  }
});

for(const profileId of ['stickcplus2','cores3','cores3se'])test(`real ${profileId}: PCM ack and native processed samples/pixels are distinct`,async t=>{
  const {root}=await prepared(t,profileId),s=await NativeSession.open({workspaceRoot:root,profileId,appId:'counter'});t.after(()=>s.close());
  const before=s.snapshot();assert.equal(before.capabilities.audioInputAdapter,1);assert.equal(before.nativeState.audio_input.requested,true);
  const call=(action,extra={})=>s.audio({sessionId:s.sessionId,streamId:'native_pcm_proof',action,...extra});
  await call('start',{source:'fixture'});const pcm=Buffer.alloc(3200);for(let i=0;i<1600;i++)pcm.writeInt16LE(16384,i*2);
  const ack=await call('chunk',{sequence:0,firstFrame:0,pcmBase64:pcm.toString('base64')});assert.equal(ack.nextFrame,1600);
  assert.equal(s.snapshot().revision,before.revision);assert.equal(s.snapshot().frame.sha256,before.frame.sha256);
  const fresh=await s.refresh();assert.equal(fresh.nativeState.audio_input.received_frames,1600);assert.equal(fresh.nativeState.audio_input.level,0.5);assert.notEqual(fresh.frame.sha256,before.frame.sha256);
  await call('stop');const stopped=await s.refresh();assert.equal(stopped.nativeState.audio_input.active,false);assert.equal(stopped.nativeState.audio_input.level,0);
});
