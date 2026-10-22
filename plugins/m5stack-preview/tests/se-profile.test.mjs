import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {NativeSession,sourceDigest} from '../server/native-session.mjs';
import {catalog,chooseProfile} from '../server/workbench.mjs';
import {INPUT_PREVIEW_CATALOG} from '../ui/input-preview.mjs';
import {mediaCapabilities} from '../ui/device-media.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const se=catalog().profiles.find(profile=>profile.id==='cores3se');
function isolatedSession(mediaAdapter=1){
  const session=new NativeSession({profile:se,meta:{build_id:'profile-test',source_sha256:'0'.repeat(64)}},{profileId:'cores3se',appId:'custom'});
  session._state={media_adapter:mediaAdapter};
  return session;
}

test('exact SE identity and hardware exclusions agree between catalog and fallback UI',()=>{
  assert.equal(chooseProfile('cores3se'),'cores3se');
  for(const alias of ['cores3-se','CoreS3 SE','cores3lite','stick-s3'])assert.throws(()=>chooseProfile(alias),/Unsupported/);
  const fallback=INPUT_PREVIEW_CATALOG.profiles.find(profile=>profile.id==='cores3se');
  for(const key of ['width','height','primaryInput','motion','microphone','audioOutput'])assert.equal(fallback[key],se[key],key);
  assert.equal(se.hardware.sku,'K128-SE');
  for(const absent of ['motion','camera','proximity','compass','includedBattery'])assert.equal(se.hardware[absent],false,absent);
  assert.deepEqual(mediaCapabilities('cores3se'),{microphone:true,audioOutput:'speaker'});
});

test('SE supervisor reports no motion and rejects shake/tilt before native I/O',()=>{
  const session=isolatedSession(),snapshot=session.snapshot();
  assert.equal(snapshot.profile,'cores3se');assert.equal(snapshot.capabilities.motion,false);
  assert.equal(snapshot.capabilities.touch,true);assert.equal(snapshot.capabilities.microphone,true);assert.equal(snapshot.capabilities.audioOutput,'speaker');
  for(const input of ['shake','tilt'])assert.equal(snapshot.capabilities.implementedInputs.includes(input),false);
  for(const event of [{type:'shake'},{type:'tilt',degrees:0},{type:'tilt',degrees:-60},{type:'tilt',degrees:60}])assert.throws(()=>session._eventCommand(event),{code:'UNSUPPORTED_INPUT'});
  assert.equal(session._child,null);assert.equal(session._eventCommand({type:'reset'}),'reset\n');
});

test('legacy SE worker accepts LCD corners and rejects the extra strip before native I/O',()=>{
  const session=isolatedSession();
  for(const [x,y] of [[0,0],[319,0],[0,239],[319,239]])assert.equal(session._eventCommand({type:'primary',durationMs:20,x,y}),`touch ${x} ${y} 20\n`);
  assert.equal(session._eventCommand({type:'primary',durationMs:20}),'touch 160 120 20\n');
  for(const [x,y] of [[320,0],[0,240],[319,279],[-1,0],[0,-1],[1.2,1]])assert.throws(()=>session._eventCommand({type:'primary',durationMs:20,x,y}),{code:'INVALID_INPUT'});
});

test('SE full touch surface requires an exact worker adapter and preserves LCD dimensions',()=>{
  const session=isolatedSession();
  session._state={app_adapter:1,touch_strip_adapter:1,profile:'cores3se',app:'custom'};
  const caps=session.snapshot().capabilities;
  assert.equal(caps.touchStrip,true);assert.equal(caps.touchHeight,280);assert.equal(caps.touchWidth,320);
  assert.deepEqual([session.snapshot().width,session.snapshot().height],[320,240]);
  for(const [x,y] of [[0,240],[107,260],[213,260],[319,279]])assert.equal(session._eventCommand({type:'primary',durationMs:20,x,y}),`touch ${x} ${y} 20\n`);
  assert.equal(session._eventCommand({type:'swipe',x:0,y:239,endX:319,endY:279,durationMs:200}),'swipe 0 239 319 279 200\n');
  for(const [x,y] of [[0,280],[320,260],[-1,260],[1,NaN],[1,260.5]])assert.throws(()=>session._eventCommand({type:'primary',durationMs:20,x,y}),{code:'INVALID_INPUT'});
  for(const state of [
    {app_adapter:1,profile:'cores3se',app:'custom'},
    {app_adapter:1,touch_strip_adapter:'1',profile:'cores3se',app:'custom'},
    {app_adapter:1,touch_strip_adapter:1,profile:'cores3',app:'custom'},
    {app_adapter:1,touch_strip_adapter:1,profile:'cores3se',app:'counter'},
    {touch_strip_adapter:1,profile:'cores3se',app:'custom'},
  ]){
    session._state=state;assert.equal(session.snapshot().capabilities.touchStrip,false);
    assert.throws(()=>session._eventCommand({type:'primary',durationMs:20,x:160,y:260}),{code:'INVALID_INPUT'});
    assert.throws(()=>session._eventCommand({type:'swipe',x:0,y:239,endX:319,endY:279,durationMs:200}),{code:'INVALID_INPUT'});
  }
});

test('fresh SE native worker delivers lower-strip taps and swipes with fixed LCD frames',{skip:!process.env.M5_SE_TOUCH_REVIEW_WORKSPACE},async t=>{
  const session=await NativeSession.open({workspaceRoot:process.env.M5_SE_TOUCH_REVIEW_WORKSPACE,profileId:'cores3se',appId:'custom'});
  t.after(()=>session.close());
  assert.equal(session.snapshot().capabilities.touchStrip,true);
  const first=await session.input({sessionId:session.sessionId,requestId:'strip-tap',event:{type:'primary',durationMs:50,x:319,y:279}});
  assert.equal(first.nativeState.count,1);assert.equal(first.nativeState.touch_strip_adapter,1);
  assert.deepEqual([first.frame.width,first.frame.height],[320,240]);
  const swipe=await session.input({sessionId:session.sessionId,requestId:'strip-swipe',event:{type:'swipe',durationMs:200,x:0,y:239,endX:319,endY:279}});
  assert.equal(swipe.nativeState.count,1);assert.equal(swipe.status,'running');
  await assert.rejects(session.input({sessionId:session.sessionId,requestId:'out-of-bounds',event:{type:'primary',durationMs:50,x:1,y:280}}),{code:'INVALID_INPUT'});
  assert.equal(session.snapshot().status,'running');
});

test('SE media remains disabled for legacy workers despite microphone/speaker hardware',()=>{
  const session=isolatedSession(0),caps=session.snapshot().capabilities;
  assert.equal(caps.microphone,false);assert.equal(caps.audioOutput,'none');
  assert.throws(()=>session._eventCommand({type:'mic',level:0.5,source:'fixture'}),{code:'UNSUPPORTED_INPUT'});
  assert.equal(isolatedSession()._eventCommand({type:'mic',level:0.5,source:'fixture'}),'mic 50.000000 fixture\n');
});

test('SE source digest is a distinct supported build identity and rejects aliases',async t=>{
  const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'m5-se-digest-'));t.after(()=>fs.rm(workspace,{recursive:true,force:true}));
  for(const directory of ['src','data','scripts','vendor/M5GFX/src/lgfx/Fonts'])await fs.mkdir(path.join(workspace,directory),{recursive:true});
  for(const name of ['dependencies.lock.json','scripts/eightball_shared.py','scripts/virtual_device.py','scripts/wav_fixture.py','vendor/M5GFX/src/lgfx/Fonts/glcdfont.h'])await fs.writeFile(path.join(workspace,name),'profile identity fixture\n');
  const seDigest=await sourceDigest(workspace,'cores3se');assert.match(seDigest,/^[0-9a-f]{64}$/);assert.notEqual(seDigest,await sourceDigest(workspace,'cores3'));
  for(const alias of ['cores3-se','cores3lite'])await assert.rejects(sourceDigest(workspace,alias),{code:'UNSUPPORTED_PROFILE'});
});

test('SE knowledge and shell do not imply a camera, IMU or included battery',async()=>{
  const knowledge=JSON.parse(await fs.readFile(path.join(root,'knowledge/devices/cores3-se-k128-se.json'),'utf8'));
  assert.equal(knowledge.native_preview.runtime_profile,'cores3se');assert.equal(knowledge.native_preview.profile_exists,true);
  assert.equal(knowledge.hardware.camera.present,false);assert.equal(knowledge.hardware.motion.accelerometer,false);assert.equal(knowledge.hardware.battery.included,false);
  assert.deepEqual(knowledge.hardware.touch.full_surface_dimensions_px,[320,280]);
  assert.deepEqual(knowledge.native_preview.touch_policy.logical_app_bounds_px,{x:0,y:0,width:320,height:280});
  assert.deepEqual(knowledge.native_preview.touch_policy.lcd_bounds_px,{x:0,y:0,width:320,height:240});
  assert.equal(knowledge.native_preview.touch_policy.extra_strip_supported,true);
  assert.equal(knowledge.native_preview.touch_policy.required_touch_strip_adapter,1);
  const css=await fs.readFile(path.join(root,'ui/style.css'),'utf8');
  assert.match(css,/\.device-shell\[data-profile=cores3se\] \.core-sensors\{display:none\}/);
});
