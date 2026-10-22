import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {WorkbenchController} from '../controller.mjs';
import {DeviceMedia} from '../device-media.mjs';

// Chromium's Window timers reject a class instance as their receiver. Ordinary
// injected arrow timers and Node timers do not, so exercise the default path
// with that browser contract instead of passing timers to these constructors.
function browserTimers(t){
  const timeouts=new Map(),intervals=new Map();let sequence=0;
  for(const [name,store] of [['setTimeout',timeouts],['setInterval',intervals]]){
    t.mock.method(globalThis,name,function(callback,ms){
      assert.equal(this,globalThis,name+' must keep the host global receiver');
      const id=++sequence;store.set(id,{callback,ms});return id;
    });
  }
  for(const [name,store] of [['clearTimeout',timeouts],['clearInterval',intervals]]){
    t.mock.method(globalThis,name,function(id){
      assert.equal(this,globalThis,name+' must keep the host global receiver');store.delete(id);
    });
  }
  return {timeouts,intervals};
}
function nativeResult(revision=1){
  return {structuredContent:{sessionId:'native-session',profile:'cores3se',app:'counter',width:320,height:240,status:'running',revision},
    _meta:{frame:{mimeType:'image/png',data:'aGVsbG8=',sha256:'a'.repeat(64),width:320,height:240}}};
}
test('controller default browser timers poll and cancel with the Window receiver',async t=>{
  const timers=browserTimers(t),calls=[];
  const controller=new WorkbenchController({call:async request=>{calls.push(request);return nativeResult(2);}});
  controller.receive(nativeResult());assert.equal(timers.timeouts.size,1);
  const [id,{callback}]=timers.timeouts.entries().next().value;timers.timeouts.delete(id);callback();
  await Promise.resolve();await Promise.resolve();
  assert.equal(calls[0].name,'m5stack_frame');assert.equal(controller.state.revision,2);assert.equal(timers.timeouts.size,1);
  controller.dispose();assert.equal(timers.timeouts.size,0);
});

test('media default browser timers allow audio resume, tone cleanup and microphone sampling',async t=>{
  const timers=browserTimers(t),contexts=[],levels=[];
  const track={kind:'audio',readyState:'live',stops:0,stop(){this.stops++;this.readyState='ended';},addEventListener(){},removeEventListener(){}};
  const stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
  const mediaDevices={async getUserMedia(){assert.equal(this,mediaDevices);return stream;}};
  const node=()=>({connect(){},disconnect(){}}),parameter=()=>({setValueAtTime(){},linearRampToValueAtTime(){}});
  const media=new DeviceMedia({profileId:'cores3se',sessionId:'native-session',mediaDevices,onMicLevel:value=>levels.push(value),
    createAudioContext:()=>{
      const context={state:'suspended',currentTime:0,destination:{},resumes:0,
        async resume(){assert.equal(this,context);this.resumes++;this.state='running';},
        async close(){assert.equal(this,context);this.state='closed';},
        createOscillator:()=>({...node(),frequency:parameter(),start(){},stop(){}}),createGain:()=>({...node(),gain:parameter()}),
        createMediaStreamSource:()=>node(),createAnalyser:()=>({...node(),getFloatTimeDomainData:buffer=>buffer.fill(.25)})};
      contexts.push(context);return context;
    }});
  t.after(()=>media.dispose());
  assert.equal(await media.enableSound(),true);assert.equal(contexts[0].resumes,1);
  assert.equal(media.state.sound.resumeDiagnostic.outcome,'resolved');assert.equal(timers.timeouts.size,0);
  assert.equal(media.testTone(),true);assert.equal(timers.timeouts.size,1);
  timers.timeouts.values().next().value.callback();assert.equal(timers.timeouts.size,0);
  assert.equal(await media.enableMic(),true);assert.equal(media.state.mic.resumeDiagnostic.outcome,'resolved');
  assert.equal(timers.intervals.size,1);timers.intervals.values().next().value.callback();assert.equal(levels.at(-1),.25);
  media.stopAll();assert.equal(timers.intervals.size,0);assert.equal(timers.timeouts.size,0);
  assert.equal(track.stops,1);assert.ok(contexts.every(context=>context.state==='closed'));
});

