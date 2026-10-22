import test from 'node:test';
import assert from 'node:assert/strict';
import {DEVICE_PROFILES,DEVICE_PROFILE_BY_ID} from '../ui/device-profiles.mjs';
import {PROFILES} from '../server/workbench.mjs';
import {INPUT_PREVIEW_CATALOG,createInputPreview,applyPreviewInput} from '../ui/input-preview.mjs';
import {mediaCapabilities} from '../ui/device-media.mjs';
import {NativeSession} from '../server/native-session.mjs';
import {generateDeviceProfiles} from '../scripts/generate-device-profiles.mjs';

test('host and browser use one immutable registry, with a current generated native table',async()=>{
  assert.equal(PROFILES,DEVICE_PROFILES);assert.equal(INPUT_PREVIEW_CATALOG.profiles,DEVICE_PROFILES);
  assert.equal(await generateDeviceProfiles({check:true}),5);
  assert.throws(()=>DEVICE_PROFILE_BY_ID.atoms3r.hardware.microphone=true,TypeError);
  assert.deepEqual(mediaCapabilities('unrecognized-board'),{microphone:false,audioOutput:'none'});
});
test('B is a separate input; exact profile and worker opt-in gate it before any write',()=>{
  for(const profile of DEVICE_PROFILES)for(const optedIn of [false,true]){
    const s=new NativeSession({profile,meta:{build_id:'test',source_sha256:'0'.repeat(64)}},{profileId:profile.id,appId:'custom'});
    s._state={profile:profile.id,app:'custom',app_adapter:1,secondary_button_adapter:optedIn?1:0};
    const permitted=profile.secondaryButton===true&&optedIn;
    for(const durationMs of [0,50,1000,60000]){
      if(permitted)assert.equal(s._eventCommand({type:'secondary',durationMs}),`secondary ${durationMs}\n`);
      else assert.throws(()=>s._eventCommand({type:'secondary',durationMs}),{code:'UNSUPPORTED_INPUT'});
    }
    for(const event of [{type:'secondary',durationMs:-1},{type:'secondary',durationMs:60001},{type:'secondary',durationMs:1,action:'click'}])
      assert.throws(()=>s._eventCommand(event),{code:'INVALID_INPUT'});
  }
});
test('B in the initial input preview never increments A or invents microphone capture',()=>{
  for(const profile of DEVICE_PROFILES){
    const state=createInputPreview(profile);
    assert.equal(applyPreviewInput(state,profile,{type:'secondary',durationMs:50}),profile.secondaryButton===true);
    assert.equal(state.count,0);assert.equal(state.micLevel,0);
  }
});

test('input backpressure rejects cleanly without evaluating a nonexistent network flag',async()=>{
 const profile=DEVICE_PROFILE_BY_ID.sticks3;
 const s=new NativeSession({profile,meta:{build_id:'test',source_sha256:'0'.repeat(64)}},{profileId:'sticks3',appId:'custom'});
 s._state={profile:'sticks3',app:'custom',app_adapter:1,secondary_button_adapter:1};s._queued=100;
 await assert.rejects(s.input({sessionId:s.sessionId,requestId:'busy_key',event:{type:'secondary',durationMs:50}}),{code:'QUEUE_FULL'});
 assert.equal(s._dedupe.size,0);
 assert.ok(s.snapshot().capabilities.implementedInputs.includes('secondary'));
});
