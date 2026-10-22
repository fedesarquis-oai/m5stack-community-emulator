import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSession} from '../server/native-session.mjs';

const root=process.env.M5_APP_REVIEW_WORKSPACE,fixture=process.env.M5_APP_REVIEW_FIXTURE,legacy=process.env.M5_TEXT_ACK_LEGACY;
const header=()=>({profile:'cores3se',app:'custom',width:320,height:240,app_adapter:1,recording:null,recording_capture:null,image:null,expected_result:null});
async function acceptHeader(value){
  const session=new NativeSession({profile:{width:320,height:240,primaryInput:'touch',motion:false,microphone:true,audioOutput:'speaker'},meta:{build_id:'test',source_sha256:'a'.repeat(64)}},
    {profileId:'cores3se',appId:'custom',ioTimeoutMs:1000,closeTimeoutMs:50});
  const result=session._expectFrame();result.catch(()=>{});
  session._read(Buffer.concat([Buffer.from(JSON.stringify(value)+'\n'),Buffer.alloc(320*240*3)]));return result;
}
async function open(t,workspace){const s=await NativeSession.open({workspaceRoot:workspace,profileId:'cores3se',appId:'custom'});t.after(()=>s.close());return s;}
const send=(s,requestId,event)=>s.input({sessionId:s.sessionId,requestId,event});
const context={draftId:'draft_fixture',requestId:'request_text',revision:1};
test('acknowledgment validates optional boolean/null while preserving explicit rejection and legacy absence',async()=>{
  for(const value of [null,true,false])assert.equal((await acceptHeader({...header(),app_input_accepted:value})).nativeState.app_input_accepted,value);
  assert.equal(Object.hasOwn((await acceptHeader(header())).nativeState,'app_input_accepted'),false);
  for(const value of [0,1,'true','false',{},[]])await assert.rejects(acceptHeader({...header(),app_input_accepted:value}),{code:'INVALID_ASSET'});
});
test('fresh native text response alone carries acceptance; refresh and later nontext input clear it',{skip:!root},async t=>{
  const s=await open(t,root),initial=s.snapshot();assert.equal(initial.nativeState.app_input_accepted,null);
  const accepted=await send(s,'text',{type:'text',text:'Deterministic acknowledgement fixture.'});
  assert.equal(accepted.nativeState.app_input_accepted,true);assert(accepted.revision>initial.revision);
  const refreshed=await s.refresh();assert.equal(refreshed.nativeState.app_input_accepted,null);assert(refreshed.revision>accepted.revision);
  const cached=await send(s,'text',{type:'text',text:'Deterministic acknowledgement fixture.'});
  assert.equal(cached.revision,refreshed.revision);assert.equal(cached.nativeState.app_input_accepted,null);
  const again=await send(s,'text_again',{type:'text',text:'Second fixture.'});assert.equal(again.nativeState.app_input_accepted,true);
  const reset=await send(s,'reset',{type:'reset'});assert.equal(reset.nativeState.app_input_accepted,null);
});
test('tagged native text acknowledges exact consumption and may arm a successor context',{skip:!fixture},async t=>{
  const s=await open(t,fixture);const armed=await send(s,'arm',{type:'primary',x:20,y:20,durationMs:50});
  assert.equal(armed.nativeState.app_input_accepted,null);
  assert.deepEqual(armed.nativeState.expected_result,{draft_id:'draft_fixture',request_id:'request_text',revision:1});
  const input={type:'text',text:'Result fixture.',context};
  const accepted=await send(s,'tagged',input);assert.equal(accepted.nativeState.app_input_accepted,true);
  assert.deepEqual(accepted.nativeState.expected_result,{draft_id:'draft_fixture',request_id:'request_image',revision:2});
  assert.equal(accepted.sessionId,armed.sessionId);assert.equal(accepted.buildId,armed.buildId);assert.equal(accepted.sourceSha256,armed.sourceSha256);
  await assert.rejects(send(s,'replay',input),{code:'STALE_RESULT'});assert.equal(s.snapshot().status,'running');
  const refresh=await s.refresh();assert.equal(refresh.nativeState.app_input_accepted,null);
  assert.equal((await send(s,'tagged',input)).revision,refresh.revision);
});
test('prior native worker remains transport-compatible but has no explicit acceptance receipt',{skip:!legacy},async t=>{
  const s=await open(t,legacy);assert.equal(Object.hasOwn(s.snapshot().nativeState,'app_input_accepted'),false);
  const reply=await send(s,'text',{type:'text',text:'Legacy fixture.'});
  assert.equal(Object.hasOwn(reply.nativeState,'app_input_accepted'),false);assert.equal(reply.status,'running');
});
