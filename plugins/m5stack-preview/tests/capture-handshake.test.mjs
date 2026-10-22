import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeSession } from '../server/native-session.mjs';

const capture=(id='clip_a',stopped=false,source='fixture')=>({id,source,stopped});
const intent=(action='start',id='clip_a',sequence=1,source='fixture')=>({id,source,action,sequence});
const recording=(id='clip_a',source='fixture')=>({id,source,mime_type:'audio/wav',duration_ms:1000,bytes:32044,sha256:'a'.repeat(64)});
const state=changes=>({profile:'cores3se',app:'custom',width:320,height:240,app_adapter:1,capture_adapter:1,
  recording:null,recording_capture:null,capture_intent:null,image:null,expected_result:null,...changes});
function session(header=state()){
  const s=new NativeSession({profile:{width:320,height:240,primaryInput:'touch',motion:false,microphone:true,audioOutput:'speaker'},meta:{build_id:'capture-test',source_sha256:'a'.repeat(64)}},
    {profileId:'cores3se',appId:'custom',ioTimeoutMs:1000,closeTimeoutMs:50});
  s._state=header;s._status='running';return s;
}
const event=(type,id='clip_a',source='fixture')=>({type,id,source});
const command=(s,e)=>s._eventCommand(e);
async function acceptHeader(header){
  const s=session();const pending=s._expectFrame();pending.catch(()=>{});
  s._read(Buffer.concat([Buffer.from(JSON.stringify(header)+'\n'),Buffer.alloc(320*240*3)]));
  return pending;
}

test('new capture capability and exact state are validated; older apps retain legacy capture shape',async()=>{
  const fresh=await acceptHeader(state({capture_intent:intent()}));
  assert.equal(fresh.capabilities.captureAdapter,1);assert.equal(fresh.capabilities.captureHandshake,true);
  assert(fresh.capabilities.implementedInputs.includes('recording_request'));
  assert.deepEqual(fresh.nativeState.capture_intent,intent());
  const legacy=state({recording_capture:{id:'clip_a',source:'fixture'}});delete legacy.capture_adapter;delete legacy.capture_intent;
  const old=await acceptHeader(legacy);assert.equal(old.capabilities.captureAdapter,0);assert.equal(old.capabilities.captureHandshake,false);
  assert.equal(old.nativeState.capture_intent,null);assert.deepEqual(old.nativeState.recording_capture,{id:'clip_a',source:'fixture'});
});

test('malformed intent/capture shapes and contradictory phases fail closed',async()=>{
  for(const bad of [
    state({capture_intent:{...intent(),sequence:0}}),state({capture_intent:{...intent(),sequence:Number.MAX_SAFE_INTEGER+1}}),
    state({capture_intent:{...intent(),action:'automatic'}}),state({capture_intent:{...intent(),url:'https://invalid.example'}}),
    state({capture_intent:{...intent(),source:'physical'}}),state({recording_capture:{id:'clip_a',source:'fixture'}}),
    state({recording_capture:capture(),capture_intent:intent()}),state({capture_intent:intent('stop')}),
    state({recording_capture:capture('clip_a',true),capture_intent:intent('stop')}),
    state({recording_capture:capture(),recording:recording()}),state({capture_intent:intent('cancel'),recording:recording()}),
  ]) await assert.rejects(acceptHeader(bad),{code:'INVALID_ASSET'});
});

test('request exposes intent but cannot acknowledge an unsolicited or mismatched Start',()=>{
  const s=session();assert.equal(command(s,event('recording_request')),'recording_request clip_a fixture\n');
  assert.throws(()=>command(s,event('recording_start')),{code:'STALE_RECORDING'});
  s._state.capture_intent=intent();
  assert.equal(command(s,event('recording_start')),'recording_start clip_a fixture\n');
  for(const invalid of [event('recording_start','old'),event('recording_start','clip_a','browser')])assert.throws(()=>command(s,invalid),{code:'STALE_RECORDING'});
  s._state=state({recording_capture:capture()});
  assert.equal(command(s,event('recording_start')),'recording_start clip_a fixture\n');
  assert.throws(()=>command(s,event('recording_request','second')),{code:'CAPTURE_BUSY'});
});

test('Ready requires Stopped; stop receipts remain idempotent through completion',()=>{
  const s=session(state({recording_capture:capture()}));
  assert.throws(()=>command(s,{type:'recording',recording:recording()}),{code:'STALE_RECORDING'});
  assert.equal(command(s,event('recording_stopped')),'recording_stopped clip_a fixture\n');
  s._state.recording_capture.stopped=true;
  assert.equal(command(s,event('recording_stopped')),'recording_stopped clip_a fixture\n');
  assert(command(s,{type:'recording',recording:recording()}).startsWith('recording clip_a '));
  assert.throws(()=>command(s,event('recording_start')),{code:'STALE_RECORDING'});
  s._state=state({recording:recording()});
  assert.equal(command(s,event('recording_stopped')),'recording_stopped clip_a fixture\n');
  assert.throws(()=>command(s,{type:'recording',recording:recording()}),{code:'STALE_RECORDING'});
});

test('scoped cleanup rejects stale/wrong-source captures without cancelling replacement',()=>{
  const s=session(state({recording_capture:capture('new_clip')}));
  for(const invalid of [event('recording_clear'),event('recording_clear','new_clip','browser')])assert.throws(()=>command(s,invalid),{code:'STALE_RECORDING'});
  assert.equal(s._state.recording_capture.id,'new_clip');
  assert.equal(command(s,event('recording_clear','new_clip')),'recording_clear new_clip fixture\n');
  s._state=state({capture_intent:intent('cancel','new_clip')});
  assert.equal(command(s,event('recording_clear','new_clip')),'recording_clear new_clip fixture\n');
  assert.equal(command(s,{type:'recording_clear'}),'recording_clear\n');
  for(const invalid of [{type:'recording_clear',id:'new_clip'},{type:'recording_clear',source:'fixture'},
    {type:'recording_clear',id:'new_clip',source:'fixture',extra:true}])assert.throws(()=>command(s,invalid),{code:'INVALID_INPUT'});
});

test('legacy Start/Ready/unscoped clear remain valid; new handshake operations are unavailable',()=>{
  const header=state({recording_capture:{id:'clip_a',source:'fixture'}});delete header.capture_adapter;
  const s=session(header);
  assert.equal(command(s,event('recording_start')),'recording_start clip_a fixture\n');
  assert(command(s,{type:'recording',recording:recording()}).startsWith('recording clip_a '));
  assert.equal(command(s,{type:'recording_clear'}),'recording_clear\n');
  for(const type of ['recording_request','recording_stopped','recording_clear'])assert.throws(()=>command(s,event(type)),{code:'UNSUPPORTED_INPUT'});
});

test('reset and queued scoped cancel are rechecked before later acknowledgements reach the worker',async()=>{
  const s=session(state({capture_intent:intent()}));let writes=[];
  s._command=async bytes=>{
    const value=String(bytes);writes.push(value);
    if(value==='reset\n')s._state=state();
    else if(value.startsWith('recording_clear'))s._state=state({capture_intent:intent('cancel')});
    return s.snapshot();
  };
  const send=(requestId,input)=>s.input({sessionId:s.sessionId,requestId,event:input});
  const reset=send('reset',{type:'reset'}),late=send('late',event('recording_start'));
  const rejection=assert.rejects(late,{code:'STALE_RECORDING'});await reset;await rejection;
  assert.deepEqual(writes,['reset\n']);assert.equal(s.snapshot().status,'running');
  s._state=state({recording_capture:capture()});writes=[];
  const cancel=send('cancel',event('recording_clear')),stopped=send('stop',event('recording_stopped'));
  const rejected=assert.rejects(stopped,{code:'STALE_RECORDING'});await cancel;await rejected;
  assert.deepEqual(writes,['recording_clear clip_a fixture\n']);
});

test('session capture identity history never evicts and survives reset',async()=>{
  const s=session();for(let i=0;i<64;i++)s._captureIds.add(`clip_${i}`);
  assert.throws(()=>command(s,event('recording_request','new')),{code:'CAPTURE_LIMIT'});
  assert.throws(()=>command(s,event('recording_request','clip_0')),{code:'STALE_RECORDING'});
  s._state=state();assert.throws(()=>command(s,event('recording_request','clip_0')),{code:'STALE_RECORDING'});
  const pending=s._expectFrame();pending.catch(()=>{});
  s._read(Buffer.concat([Buffer.from(JSON.stringify(state({capture_intent:intent('start','new',65)}))+'\n'),Buffer.alloc(320*240*3)]));
  await assert.rejects(pending,{code:'CAPTURE_LIMIT'});
});
