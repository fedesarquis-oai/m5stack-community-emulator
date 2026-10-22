import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSession} from '../server/native-session.mjs';

const pcm=frames=>Buffer.alloc(frames*2,0x11).toString('base64');
function fixture(t,{profile='cores3se',supported=true,transform=x=>x,hold=false}={}){
  const p={id:profile,width:320,height:240,primaryInput:'touch',motion:false,microphone:profile!=='atoms3r',audioOutput:'speaker'};
  const s=new NativeSession({profile:p,meta:{build_id:'test',source_sha256:'0'.repeat(64)}},{profileId:profile,appId:'counter',ioTimeoutMs:1000,closeTimeoutMs:50});
  s._status='running';s._state={profile,app:'counter',audio_input_adapter:supported?1:0,audio_input:{requested:true,active:false,stream_id:null,source:null,sequence:-1,next_frame:0}};
  const frame=Buffer.from('sentinel last PNG');s._frame={png:frame};let sequence=-1,nextFrame=0,active=false;const writes=[];
  s._child={stdin:{write(bytes,callback){
    const copy=Buffer.from(bytes);writes.push(copy);callback?.();if(hold)return;
    const newline=copy.indexOf(10),[command,id,...args]=copy.subarray(0,newline).toString().split(' ');let action;
    if(command==='audio_start'){action='start';sequence=-1;nextFrame=0;active=true;assert.equal(copy.length,newline+1);}
    else if(command==='audio_chunk'){action='chunk';const [seq,first,count]=args.map(Number);assert.equal(copy.length,newline+1+count*2);assert.equal(first,nextFrame);sequence=seq;nextFrame+=count;}
    else {assert.equal(command,'audio_stop');action='stop';active=false;assert.equal(copy.length,newline+1);}
    const ack=transform({type:'audio_ack',profile,app:'counter',stream_id:id,action,accepted:true,sequence,next_frame:nextFrame,requested:true,active});
    const data=Buffer.from(JSON.stringify(ack)+'\n');queueMicrotask(()=>{s._read(data.subarray(0,9));s._read(data.subarray(9));});
  }}};
  t.after(()=>{clearTimeout(s._audioTimer);s._status='stopped';s._markFailed(new Error('test done'));});
  const call=(action,extra={})=>s.audio({sessionId:s.sessionId,streamId:'stream_1',action,...extra});
  return {s,call,writes,frame};
}
test('PCM transport emits bounded binary then accepts lightweight ack without changing frame or revision',async t=>{
  const {s,call,writes,frame}=fixture(t);
  assert.equal(s.snapshot().capabilities.audioInputAdapter,1);assert.equal(s.snapshot().capabilities.microphonePcm,true);
  assert.deepEqual(await call('start',{source:'browser'}),{sessionId:s.sessionId,streamId:'stream_1',action:'start',accepted:true,sequence:-1,nextFrame:0,requested:true,active:true,revision:0});
  const result=await call('chunk',{sequence:0,firstFrame:0,pcmBase64:pcm(1600)});
  assert.equal(result.nextFrame,1600);assert.equal(result.sequence,0);assert.equal(s._revision,0);assert.equal(s._frame.png,frame);
  const newline=writes[1].indexOf(10);assert.equal(writes[1].subarray(0,newline).toString(),'audio_chunk stream_1 0 0 1600');assert.deepEqual(writes[1].subarray(newline+1),Buffer.alloc(3200,0x11));
  assert.equal(Object.keys(result).length,9);assert.equal(result.revision,0);assert.equal('frame' in result,false);assert.equal('pcmBase64' in result,false);
  await call('chunk',{sequence:1,firstFrame:1600,pcmBase64:pcm(23)});
  await assert.rejects(call('chunk',{sequence:2,firstFrame:1623,pcmBase64:pcm(1)}),{code:'AUDIO_ORDER'});
  s._revision=3;const stop=await call('stop');assert.equal(stop.revision,3);assert.equal(stop.active,false);assert.equal(stop.nextFrame,1623);
  assert.deepEqual(await call('stop'),stop);
  await assert.rejects(call('start',{source:'browser'}),{code:'STALE_AUDIO_STREAM'});
});
test('legacy worker and non-microphone hardware cannot accept PCM even with forged capability flag',async t=>{
  for(const options of [{supported:false},{profile:'atoms3r'}]){
    const {s,call,writes}=fixture(t,options);assert.equal(s.snapshot().capabilities.audioInputAdapter,0);
    await assert.rejects(call('start',{source:'browser'}),{code:'UNSUPPORTED_AUDIO'});assert.equal(writes.length,0);
  }
});
test('reject stale identity, malformed bytes, source, order and frame bounds before native write',async t=>{
  const {s,call,writes}=fixture(t);await call('start',{source:'fixture'});
  const base={sessionId:s.sessionId,streamId:'stream_1',action:'chunk',sequence:0,firstFrame:0,pcmBase64:pcm(1600)};
  for(const update of [{sessionId:'old'},{streamId:'old'},{streamId:'bad\ncommand'},{sequence:1},{firstFrame:1},{pcmBase64:pcm(1601)},{pcmBase64:'AA=='},{pcmBase64:'AB=='},{pcmBase64:'!!!!'},{pcmBase64:pcm(1),source:'browser'},{sequence:Infinity},{firstFrame:4800000}])await assert.rejects(s.audio({...base,...update}));
  assert.equal(writes.length,1);
  await call('chunk',{sequence:0,firstFrame:0,pcmBase64:pcm(1600)});
  await assert.rejects(s.audio(base),{code:'AUDIO_ORDER'});assert.equal(writes.length,2);
});
test('single outstanding audio bound is independent from ordinary input queue; queued audio rechecks state',async t=>{
  const {s,call,writes}=fixture(t);let release;s._tail=new Promise(resolve=>{release=resolve;});
  const first=call('start',{source:'browser'});await assert.rejects(call('start',{source:'browser'}),{code:'AUDIO_BUSY'});
  s._state.audio_input.requested=false;release();await assert.rejects(first,{code:'AUDIO_NOT_REQUESTED'});assert.equal(writes.length,0);assert.equal(s._queued,0);
});
test('app withdrawal returns rejected acknowledgment without additional PCM writes',async t=>{
  const {s,call,writes}=fixture(t);await call('start',{source:'browser'});s._state.audio_input.requested=false;s._state.audio_input.active=false;s._revision=7;
  const ack=await call('chunk',{sequence:0,firstFrame:0,pcmBase64:pcm(1600)});
  assert.equal(ack.revision,7);assert.equal(ack.accepted,false);assert.equal(ack.requested,false);assert.equal(ack.active,false);assert.equal(ack.nextFrame,0);assert.equal(ack.sequence,-1);assert.equal(writes.length,1);
});
test('malformed native acknowledgment invalidates session while preserving last framebuffer',async t=>{
  const {s,call,frame}=fixture(t,{transform:ack=>({...ack,sequence:0,next_frame:1})});
  await assert.rejects(call('start',{source:'browser'}),{code:'INVALID_AUDIO_ACK'});assert.equal(s._status,'unavailable');assert.equal(s._frame.png,frame);
});
test('5 second idle watchdog stops stream without another browser submission',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date']});const {s,call,writes}=fixture(t);await call('start',{source:'browser'});
  t.mock.timers.tick(5001);await s._tail;await Promise.resolve();assert.equal(s._audioStream.active,false);assert.equal(writes.length,2);assert.match(writes[1].toString(),/^audio_stop /);
});
test('absolute five minute limit rejects chunk even when idle interval has been refreshed',async t=>{
  const {s,call,writes}=fixture(t);await call('start',{source:'browser'});s._audioStream.startedAt=Date.now()-300001;
  await assert.rejects(call('chunk',{sequence:0,firstFrame:0,pcmBase64:pcm(1)}),{code:'AUDIO_LIMIT'});assert.equal(writes.length,1);
  await call('stop');assert.equal(s._audioStream.active,false);
});
test('failed watchdog stop closes the owned worker once instead of retrying audio',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date']});
  const {s,call,writes}=fixture(t,{transform:ack=>ack.action==='stop'?{...ack,accepted:false,active:true}:ack});let closed=0;
  s.close=async()=>{closed++;s._status='stopped';clearTimeout(s._audioTimer);};
  await call('start',{source:'browser'});t.mock.timers.tick(5001);await s._tail;await Promise.resolve();await Promise.resolve();
  t.mock.timers.tick(20000);await Promise.resolve();assert.equal(closed,1);assert.equal(writes.length,2);assert.equal(s._status,'stopped');
});
