import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSession} from '../server/native-session.mjs';

const workspace=process.env.M5_APP_REVIEW_WORKSPACE;
const fixture=process.env.M5_APP_REVIEW_FIXTURE;
const legacy=process.env.M5_CAPTURE_REVIEW_LEGACY;
async function open(t,root=workspace,profileId='cores3se'){
  const session=await NativeSession.open({workspaceRoot:root,profileId,appId:'custom'});
  t.after(()=>session.close());return session;
}
const send=(s,requestId,event)=>s.input({sessionId:s.sessionId,requestId,event});
const event=(type,id='clip_a',source='fixture')=>({type,id,source});
const ready=(id='clip_a',source='fixture')=>({type:'recording',recording:{id,source,mime_type:'audio/wav',duration_ms:1000,bytes:32044,sha256:'a'.repeat(64)}});
const tap=(s,id,x,y)=>send(s,id,{type:'primary',x,y,durationMs:50});

for(const profileId of ['atoms3r','stickcplus2','cores3','cores3se'])test(`fresh ${profileId}: exact capture capability and passive state stays inert`,{skip:!workspace},async t=>{
  const s=await open(t,workspace,profileId),initial=s.snapshot();
  assert.equal(initial.capabilities.captureAdapter,1);
  assert.equal(initial.capabilities.captureHandshake,profileId!=='atoms3r');
  assert.equal(initial.nativeState.capture_intent,null);assert.equal(initial.nativeState.recording_capture,null);
  if(profileId==='cores3se')assert.equal(initial.capabilities.motion,false);
  for(let i=0;i<5;i++)assert.equal(s.snapshot().nativeState.capture_intent,null);
  if(profileId==='atoms3r')await assert.rejects(send(s,'unsupported',event('recording_request')),{code:'UNSUPPORTED_INPUT'});
  else {
    await send(s,'request',event('recording_request'));
    assert.deepEqual(s.snapshot().nativeState.capture_intent,{id:'clip_a',source:'fixture',action:'start',sequence:1});
    assert.equal(s.snapshot().nativeState.recording_capture,null);
  }
});

test('real worker: request, Started, Stopped, Ready and receipt retry ordering',{skip:!workspace},async t=>{
  const s=await open(t);await assert.rejects(send(s,'unsolicited',event('recording_start')),{code:'STALE_RECORDING'});
  const request=await send(s,'request',event('recording_request'));
  const duplicateRequest=await send(s,'request',event('recording_request'));assert.equal(duplicateRequest.revision,request.revision);
  const samePending=await send(s,'request_again',event('recording_request'));assert.deepEqual(samePending.nativeState.capture_intent,request.nativeState.capture_intent);
  await assert.rejects(send(s,'wrong_start',event('recording_start','clip_a','browser')),{code:'STALE_RECORDING'});
  const started=await send(s,'start',event('recording_start'));
  assert.equal(started.nativeState.capture_intent,null);assert.deepEqual(started.nativeState.recording_capture,{id:'clip_a',source:'fixture',stopped:false});
  assert.deepEqual((await send(s,'start_again',event('recording_start'))).nativeState,started.nativeState);
  await assert.rejects(send(s,'premature_ready',ready()),{code:'STALE_RECORDING'});
  const stopped=await send(s,'stopped',event('recording_stopped'));
  assert.deepEqual(stopped.nativeState.recording_capture,{id:'clip_a',source:'fixture',stopped:true});
  assert.deepEqual((await send(s,'stopped_again',event('recording_stopped'))).nativeState,stopped.nativeState);
  const completed=await send(s,'ready',ready());assert.equal(completed.nativeState.recording.id,'clip_a');assert.equal(completed.nativeState.recording_capture,null);
  assert.equal((await send(s,'ready',ready())).revision,completed.revision);
  assert.deepEqual((await send(s,'late_stopped',event('recording_stopped'))).nativeState,completed.nativeState);
  await assert.rejects(send(s,'replayed_ready',ready()),{code:'STALE_RECORDING'});assert.equal(s.snapshot().status,'running');
});

test('real worker: scoped cancel, replacement and reset reject late acknowledgements and identity replay',{skip:!workspace},async t=>{
  const s=await open(t);await send(s,'request_a',event('recording_request'));
  await send(s,'cancel_a',event('recording_clear'));
  await assert.rejects(send(s,'late_start_a',event('recording_start')),{code:'STALE_RECORDING'});
  await assert.rejects(send(s,'reuse_a',event('recording_request')),{code:'STALE_RECORDING'});
  await send(s,'request_b',event('recording_request','clip_b'));
  await assert.rejects(send(s,'stale_clear_a',event('recording_clear')),{code:'STALE_RECORDING'});
  assert.equal(s.snapshot().nativeState.capture_intent.id,'clip_b');
  await send(s,'start_b',event('recording_start','clip_b'));
  const reset=send(s,'reset',{type:'reset'}),late=send(s,'late_stop_b',event('recording_stopped','clip_b'));
  const rejected=assert.rejects(late,{code:'STALE_RECORDING'});await reset;await rejected;
  await assert.rejects(send(s,'ready_b',ready('clip_b')),{code:'STALE_RECORDING'});
  await assert.rejects(send(s,'reuse_b',event('recording_request','clip_b')),{code:'STALE_RECORDING'});
  await send(s,'request_c',event('recording_request','clip_c'));
  assert(s.snapshot().nativeState.capture_intent.sequence>1);assert.equal(s.snapshot().status,'running');
});

test('authored fixture chooses canonical clip ID from explicit toolbar request',{skip:!fixture},async t=>{
  const s=await open(t,fixture);await send(s,'request',event('recording_request','proposed'));
  assert.equal(s.snapshot().nativeState.capture_intent.id,'owned_proposed');
  await assert.rejects(send(s,'wrong',event('recording_start','proposed')),{code:'STALE_RECORDING'});
  await send(s,'start',event('recording_start','owned_proposed'));
  await send(s,'stopped',event('recording_stopped','owned_proposed'));
  await send(s,'ready',ready('owned_proposed'));
  assert.equal(s.snapshot().nativeState.recording.id,'owned_proposed');
});

test('authored fixture: device Start/Stop and device Cancel preserve actual capture handshake',{skip:!fixture},async t=>{
  const s=await open(t,fixture);await tap(s,'device_start',20,180);
  assert.deepEqual(s.snapshot().nativeState.capture_intent,{id:'device_capture',source:'fixture',action:'start',sequence:1});
  await send(s,'started',event('recording_start','device_capture'));
  await tap(s,'device_stop',150,180);
  assert.equal(s.snapshot().nativeState.capture_intent.action,'stop');assert.equal(s.snapshot().nativeState.recording_capture.stopped,false);
  await assert.rejects(send(s,'premature',ready('device_capture')),{code:'STALE_RECORDING'});
  await send(s,'stopped',event('recording_stopped','device_capture'));
  assert.equal(s.snapshot().nativeState.capture_intent,null);
  await tap(s,'device_cancel',250,180);
  assert.equal(s.snapshot().nativeState.capture_intent.action,'cancel');
  await assert.rejects(send(s,'late_ready',ready('device_capture')),{code:'STALE_RECORDING'});
  assert.equal(s.snapshot().status,'running');
});

test('legacy UserApp compiled in new worker keeps old Start/Ready flow and omits capture adapter',{skip:!legacy},async t=>{
  const s=await open(t,legacy),initial=s.snapshot();
  assert.equal(initial.capabilities.captureAdapter,0);assert.equal(initial.capabilities.captureHandshake,false);
  assert.equal(initial.nativeState.capture_adapter,undefined);assert.equal(initial.nativeState.capture_intent,null);
  for(const type of ['recording_request','recording_stopped','recording_clear'])await assert.rejects(send(s,'unsupported_'+type,event(type)),{code:'UNSUPPORTED_INPUT'});
  await send(s,'start',event('recording_start'));
  assert.deepEqual(s.snapshot().nativeState.recording_capture,{id:'clip_a',source:'fixture'});
  await send(s,'ready',ready());assert.equal(s.snapshot().nativeState.recording.id,'clip_a');
  await send(s,'clear',{type:'recording_clear'});assert.equal(s.snapshot().nativeState.recording,null);assert.equal(s.snapshot().status,'running');
});
