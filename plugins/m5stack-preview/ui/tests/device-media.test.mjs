import test from 'node:test';
import assert from 'node:assert/strict';
import {DeviceMedia,mediaCapabilities,normalizedRms} from '../device-media.mjs';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
class FakeEvents{
  constructor(){this.listeners=new Map();this.hidden=false;}
  addEventListener(type,callback){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(callback);}
  removeEventListener(type,callback){this.listeners.get(type)?.delete(callback);}
  dispatch(type){for(const callback of [...this.listeners.get(type)??[]])callback();}
  listenerCount(){return [...this.listeners.values()].reduce((sum,set)=>sum+set.size,0);}
}
function fakeStream(){
  const track=new FakeEvents();track.readyState='live';track.stops=0;track.stop=()=>{track.stops++;track.readyState='ended';};
  return {track,getTracks:()=>[track],getAudioTracks:()=>[track]};
}
function harness(profileId='cores3',overrides={}){
  const intervals=new Map(),timeouts=new Map(),contexts=[],states=[],levels=[],requests=[];
  const document=new FakeEvents(),window=new FakeEvents();let timerId=0;
  function node(){return {connections:[],disconnects:0,connect(target){this.connections.push(target);},disconnect(){this.disconnects++;}};}
  function parameter(){return {values:[],setValueAtTime(value,time){this.values.push({type:'set',value,time});},linearRampToValueAtTime(value,time){this.values.push({type:'ramp',value,time});}};}
  function createAudioContext(){
    const context={state:'suspended',currentTime:10,destination:{destination:true},closes:0,resumes:0,sources:[],analysers:[],oscillators:[],gains:[],
      async resume(){this.resumes++;if(overrides.resume)await overrides.resume(this);this.state='running';},
      async close(){this.closes++;this.state='closed';},
      createMediaStreamSource(stream){const source={...node(),stream};this.sources.push(source);return source;},
      createAnalyser(){const analyser={...node(),fftSize:0,getFloatTimeDomainData(samples){if(overrides.sampleError)throw new Error('sample failure');samples.fill(overrides.sample??0.5);}};this.analysers.push(analyser);return analyser;},
      createOscillator(){const oscillator={...node(),frequency:parameter(),starts:[],stops:[],start(time){this.starts.push(time);},stop(time){this.stops.push(time);}};this.oscillators.push(oscillator);return oscillator;},
      createGain(){const gain={...node(),gain:parameter()};this.gains.push(gain);return gain;},
    };contexts.push(context);return context;
  }
  const media=new DeviceMedia({profileId,sessionId:'session-a',document,window,
    userActivation:overrides.userActivation,
    now:overrides.now??(()=>0),
    onState:state=>{states.push(state);overrides.onState?.(state);},
    onMicLevel:(level,identity)=>levels.push({level,...identity}),
    mediaDevices:overrides.unavailable?undefined:{getUserMedia:constraints=>{requests.push(constraints);return overrides.getUserMedia?.(constraints)??Promise.resolve(fakeStream());}},
    createAudioContext:overrides.createAudioContext??createAudioContext,
    setInterval:(callback,ms)=>{const id=++timerId;intervals.set(id,{callback,ms});return id;},clearInterval:id=>intervals.delete(id),
    setTimeout:(callback,ms)=>{const id=++timerId;timeouts.set(id,{callback,ms});return id;},clearTimeout:id=>timeouts.delete(id),
  });
  return {media,intervals,timeouts,contexts,states,levels,requests,document,window,tick(){for(const {callback} of [...intervals.values()])callback();},expire(){for(const {callback} of [...timeouts.values()])callback();}};
}

for(const profileId of ['atoms3r','stickcplus2','cores3','cores3se']){
  test(profileId+' constructing and session/profile changes never activate browser media',()=>{
    const h=harness(profileId);assert.equal(h.requests.length,0);assert.equal(h.contexts.length,0);
    assert.equal(h.media.state.sound.enabled,false);assert.equal(h.media.state.mic.status,'off');
    h.media.setSession('session-b');h.media.setProfile('cores3');
    assert.equal(h.requests.length,0);assert.equal(h.contexts.length,0);h.media.dispose();
  });
}
test('exact device profiles gate media; unknown SKUs/plain Atom cannot inherit capabilities',async()=>{
  assert.deepEqual(mediaCapabilities('atoms3r'),{microphone:false,audioOutput:'none'});
  assert.deepEqual(mediaCapabilities('stickcplus2'),{microphone:true,audioOutput:'buzzer'});
  assert.deepEqual(mediaCapabilities('sticks3'),{microphone:true,audioOutput:'speaker'});
  assert.deepEqual(mediaCapabilities('cores3'),{microphone:true,audioOutput:'speaker'});
  assert.deepEqual(mediaCapabilities('cores3se'),{microphone:true,audioOutput:'speaker'});
  for(const profileId of ['atoms3r','stick-s3','cores3-se','cores3lite','atom','unknown','__proto__','constructor']){
    const h=harness(profileId);assert.equal(await h.media.enableMic(),false,profileId);assert.equal(await h.media.enableSound(),false,profileId);
    assert.equal(h.media.testTone(),false);assert.equal(h.requests.length,0);assert.equal(h.contexts.length,0);h.media.dispose();
  }
});
test('normalized RMS is bounded and handles silence/nonfinite samples',()=>{
  assert.equal(normalizedRms([]),0);assert.equal(normalizedRms(null),0);
  assert.equal(normalizedRms([0,0,0]),0);assert.equal(normalizedRms([1,-1,1,-1]),1);
  assert.equal(normalizedRms([0.5,-0.5]),0.5);assert.equal(normalizedRms([100,-100]),1);
  assert.equal(normalizedRms([NaN,Infinity,-Infinity]),0);
});
test('explicit mic request creates a nonmonitoring 5 Hz RMS input with minimal constraints',async()=>{
  const h=harness();assert.equal(await h.media.enableMic(),true);
  assert.deepEqual(h.requests,[{audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false}]);
  assert.equal(h.media.state.mic.status,'active');assert.equal(h.intervals.size,1);
  assert.equal([...h.intervals.values()][0].ms,200);
  const context=h.contexts[0];assert.deepEqual(context.sources[0].connections,[context.analysers[0]]);
  assert.deepEqual(context.analysers[0].connections,[]);assert.equal(context.oscillators.length,0);
  h.tick();assert.deepEqual(h.levels,[{level:0.5,profileId:'cores3',sessionId:'session-a'}]);
  assert.equal(h.media.state.mic.level,0.5);
  assert.equal(await h.media.enableMic(),true);assert.equal(h.requests.length,1);
  h.media.stopMic();assert.equal(context.closes,1);assert.equal(context.sources[0].stream.track.stops,1);
  assert.equal(context.sources[0].disconnects,1);assert.equal(context.analysers[0].disconnects,1);
  assert.equal(h.intervals.size,0);assert.equal(h.media.state.mic.level,0);assert.equal(h.levels.at(-1).level,0);h.media.dispose();
});
for(const reason of ['stop','profile','session','hidden','pagehide','dispose']){
  test('pending microphone permission is canceled safely by '+reason,async()=>{
    const request=deferred(),stream=fakeStream(),h=harness('cores3',{getUserMedia:()=>request.promise});
    const enabled=h.media.enableMic();assert.equal(h.media.state.mic.status,'requesting');
    assert.equal(await h.media.enableMic(),false);assert.equal(h.requests.length,1);
    if(reason==='stop')h.media.stopMic();
    if(reason==='profile')h.media.setProfile('atoms3r');
    if(reason==='session')h.media.setSession('session-b');
    if(reason==='hidden'){h.document.hidden=true;h.document.dispatch('visibilitychange');}
    if(reason==='pagehide')h.window.dispatch('pagehide');
    if(reason==='dispose')h.media.dispose();
    assert.equal(await enabled,false);assert.equal(h.media.state.mic.accessDiagnostic.outcome,'cancelled');
    request.resolve(stream);await Promise.resolve();assert.equal(stream.track.stops,1);
    assert.equal(h.contexts.length,1);assert.equal(h.contexts[0].closes,1);assert.equal(h.intervals.size,0);assert.equal(h.timeouts.size,0);assert.equal(h.media.state.mic.status,'off');h.media.dispose();
  });
}
for(const reason of ['track-ended','profile','session','hidden','pagehide','dispose']){
  test('active microphone and listeners released on '+reason,async()=>{
    const h=harness();await h.media.enableMic();const context=h.contexts[0],track=context.sources[0].stream.track;
    assert.equal(track.listenerCount(),1);
    if(reason==='track-ended')track.dispatch('ended');
    if(reason==='profile')h.media.setProfile('stickcplus2');
    if(reason==='session')h.media.setSession('session-b');
    if(reason==='hidden'){h.document.hidden=true;h.document.dispatch('visibilitychange');h.document.hidden=false;h.document.dispatch('visibilitychange');}
    if(reason==='pagehide')h.window.dispatch('pagehide');
    if(reason==='dispose')h.media.dispose();
    assert.equal(track.stops,1);assert.equal(track.listenerCount(),0);assert.equal(context.closes,1);
    assert.equal(h.intervals.size,0);assert.equal(h.requests.length,1);assert.equal(h.media.state.mic.status,'off');h.media.dispose();
  });
}
test('cancel while microphone AudioContext resumes closes all held resources',async()=>{
  const resume=deferred(),h=harness('cores3',{resume:()=>resume.promise});
  const promise=h.media.enableMic();await Promise.resolve();
  assert.equal(h.contexts.length,1);h.media.stopMic();resume.resolve();
  assert.equal(await promise,false);assert.equal(h.contexts[0].closes,1);
  assert.equal(h.contexts[0].sources.length,0);assert.equal(h.intervals.size,0);h.media.dispose();
});
test('denied microphone is actionable and can be retried without background activation',async()=>{
  let tries=0;const h=harness('cores3',{getUserMedia:()=>++tries===1?Promise.reject(Object.assign(new Error('private browser detail'),{name:'NotAllowedError'})):Promise.resolve(fakeStream())});
  assert.equal(await h.media.enableMic(),false);assert.equal(h.media.state.mic.status,'error');
  assert.equal(h.media.state.mic.error,'Microphone access was denied by the app or system. Check microphone permissions; this host may block plugin recording.');assert.equal(h.media.state.mic.errorCode,'MICROPHONE_BLOCKED');assert.equal(h.contexts.length,1);assert.equal(h.contexts[0].closes,1);
  assert.equal(await h.media.enableMic(),true);assert.equal(tries,2);h.media.dispose();
});
test('unavailable mic, failed context, and failed RMS reads release resources',async()=>{
  const unavailable=harness('cores3',{unavailable:true});assert.equal(await unavailable.media.enableMic(),false);assert.equal(unavailable.media.state.mic.status,'unavailable');unavailable.media.dispose();
  const stream=fakeStream(),failed=harness('cores3',{getUserMedia:()=>Promise.resolve(stream),createAudioContext:()=>{throw new Error('unsupported');}});
  assert.equal(await failed.media.enableMic(),false);assert.equal(failed.requests.length,0);assert.equal(stream.track.stops,0);assert.equal(failed.media.state.mic.status,'error');failed.media.dispose();
  const sample=harness('cores3',{sampleError:true});await sample.media.enableMic();sample.tick();
  assert.equal(sample.media.state.mic.status,'error');assert.equal(sample.intervals.size,0);assert.equal(sample.contexts[0].closes,1);sample.media.dispose();
});
test('state getter gives detached copies and never leaks streams, context, or samples',async()=>{
  const h=harness();await h.media.enableMic();h.tick();const state=h.media.state;
  state.mic.level=99;state.sound.enabled=true;state.capabilities.microphone=false;
  assert.equal(h.media.state.mic.level,0.5);assert.equal(h.media.state.sound.enabled,false);assert.equal(h.media.state.capabilities.microphone,true);
  assert.deepEqual(Object.keys(state).sort(),['capabilities','disposed','mic','profileId','sessionId','sound']);h.media.dispose();
});
for(const [profileId,type] of [['stickcplus2','square'],['cores3','sine'],['cores3se','sine']]){
  test(profileId+' has explicit muted-by-default bounded '+type+' tone output',async()=>{
    const h=harness(profileId);assert.equal(h.media.testTone(),false);assert.equal(h.contexts.length,0);
    assert.equal(await h.media.enableSound(),true);assert.equal(h.contexts.length,1);assert.equal(h.contexts[0].resumes,1);
    assert.equal(h.contexts[0].oscillators.length,0,'Enable sound itself must remain silent');
    assert.equal(h.media.testTone({frequencyHz:440,durationMs:4000}),true);
    const context=h.contexts[0],oscillator=context.oscillators[0],gain=context.gains[0];
    assert.equal(oscillator.type,type);assert.deepEqual(oscillator.starts,[10]);assert.deepEqual(oscillator.stops,[11]);
    assert.equal(oscillator.frequency.values[0].value,440);assert.equal(gain.connections[0],context.destination);
    assert.ok(gain.gain.values.every(value=>value.value<=0.06));assert.equal([...h.timeouts.values()][0].ms,1100);
    h.media.muteSound();assert.equal(context.closes,1);assert.equal(h.timeouts.size,0);assert.equal(gain.disconnects,1);
    assert.equal(oscillator.disconnects,1);assert.equal(h.media.testTone(),false);h.media.dispose();
  });
}
test('app tones suppress initial history, muted observations, duplicates, stale sessions and stale sequence numbers',async()=>{
  const h=harness(),cue=(id,extra={})=>h.media.acceptAppTone({sessionId:'session-a',cueId:id,frequencyHz:600,durationMs:120,...extra});
  assert.equal(cue(4),false);assert.equal(cue(5),false);await h.media.enableSound();
  assert.equal(cue(5),false);assert.equal(cue(4),false);assert.equal(cue(6),true);assert.equal(cue(6),false);
  assert.equal(cue(7,{sessionId:'session-old'}),false);assert.equal(cue(7,{channel:'unknown'}),false);
  assert.equal(cue(3,{channel:'diagnostic'}),false);assert.equal(cue(4,{channel:'diagnostic'}),true);
  assert.equal(h.contexts[0].oscillators.length,2);
  h.media.muteSound();assert.equal(cue(8),false);await h.media.enableSound();assert.equal(cue(8),false);assert.equal(cue(9),true);
  h.media.setSession('session-b');assert.equal(cue(10),false);await h.media.enableSound();
  assert.equal(cue(100,{sessionId:'session-b'}),false);assert.equal(cue(101,{sessionId:'session-b'}),true);h.media.dispose();
});
test('pending sound resume consumes cues silently and cannot resurrect on session change',async()=>{
  const resume=deferred(),h=harness('cores3',{resume:()=>resume.promise});
  h.media.acceptAppTone({sessionId:'session-a',cueId:0});const enabled=h.media.enableSound();
  assert.equal(h.media.acceptAppTone({sessionId:'session-a',cueId:1,frequencyHz:440,durationMs:20}),false);
  h.media.setSession('session-b');resume.resolve();assert.equal(await enabled,false);
  assert.equal(h.contexts[0].closes,1);assert.equal(h.media.state.sound.enabled,false);assert.equal(h.contexts[0].oscillators.length,0);h.media.dispose();
});
test('diagnostic test tones do not alter application cue sequence',async()=>{
  const h=harness();await h.media.enableSound();assert.equal(h.media.testTone(),true);
  assert.equal(h.media.acceptAppTone({sessionId:'session-a',cueId:5,frequencyHz:500,durationMs:100}),false);
  assert.equal(h.media.acceptAppTone({sessionId:'session-a',cueId:6,frequencyHz:500,durationMs:100}),true);
  assert.equal(h.contexts[0].oscillators.length,2);h.media.dispose();
});
test('repeated tones stay monophonic; natural ending and fallback timeout disconnect nodes',async()=>{
  const h=harness();await h.media.enableSound();h.media.testTone();h.media.testTone();
  const context=h.contexts[0];assert.equal(context.oscillators[0].disconnects,1);assert.equal(h.timeouts.size,1);
  context.oscillators[1].onended();assert.equal(context.oscillators[1].disconnects,1);assert.equal(h.timeouts.size,0);
  h.media.testTone();h.expire();assert.equal(context.oscillators[2].disconnects,1);assert.equal(h.timeouts.size,0);h.media.dispose();
});
test('volume is bounded, reducing it stops active output immediately, and zero stays silent',async()=>{
  const h=harness();await h.media.enableSound();h.media.testTone();
  assert.equal(h.media.setVolume(0),true);assert.equal(h.contexts[0].oscillators[0].disconnects,1);assert.equal(h.media.testTone(),false);
  assert.equal(h.media.setVolume(Infinity),false);assert.equal(h.media.setVolume(NaN),false);assert.equal(h.media.setVolume('1'),false);
  h.media.setVolume(99);assert.equal(h.media.state.sound.volume,1);h.media.testTone();assert.ok(h.contexts[0].gains.at(-1).gain.values.every(value=>value.value<=0.06));
  h.media.setVolume(-99);assert.equal(h.media.state.sound.volume,0);h.media.dispose();
});
test('invalid tone data and cue IDs never create audio nodes',async()=>{
  const h=harness();await h.media.enableSound();
  for(const frequencyHz of [0,-1,NaN,Infinity,19,20001,'440'])assert.equal(h.media.testTone({frequencyHz}),false);
  for(const durationMs of [0,-1,NaN,Infinity,'10'])assert.equal(h.media.testTone({durationMs}),false);
  for(const cueId of [-1,NaN,Infinity,0.1,'2',Number.MAX_SAFE_INTEGER+1])assert.equal(h.media.acceptAppTone({sessionId:'session-a',cueId,frequencyHz:400,durationMs:100}),false);
  assert.equal(h.contexts[0].oscillators.length,0);h.media.dispose();
});
test('hidden page refuses activation; dispose removes listeners and prevents later activation',async()=>{
  const h=harness();h.document.hidden=true;assert.equal(await h.media.enableMic(),false);assert.equal(await h.media.enableSound(),false);
  assert.equal(h.requests.length,0);assert.equal(h.contexts.length,0);h.document.hidden=false;
  await h.media.enableMic();await h.media.enableSound();h.media.testTone();h.media.dispose();h.media.dispose();
  assert.equal(h.document.listenerCount(),0);assert.equal(h.window.listenerCount(),0);assert.equal(h.intervals.size,0);assert.equal(h.timeouts.size,0);
  assert.equal(await h.media.enableMic(),false);assert.equal(await h.media.enableSound(),false);assert.equal(h.media.testTone(),false);
  assert.equal(h.requests.length,1);assert.equal(h.contexts.length,2);
});
test('sound resume failure is visible and releases its context',async()=>{
  const h=harness('cores3',{resume:()=>Promise.reject(new Error('blocked'))});
  assert.equal(await h.media.enableSound(),false);assert.equal(h.media.state.sound.status,'error');assert.equal(h.media.state.sound.enabled,false);
  assert.equal(h.contexts[0].closes,1);assert.equal(h.contexts[0].oscillators.length,0);h.media.dispose();
});
test('late canceled permission cannot replace or close a newer active microphone',async()=>{
  const first=deferred(),oldStream=fakeStream(),newStream=fakeStream();let requests=0;
  const h=harness('cores3',{getUserMedia:()=>++requests===1?first.promise:Promise.resolve(newStream)});
  const pending=h.media.enableMic();h.media.stopMic();assert.equal(await h.media.enableMic(),true);
  first.resolve(oldStream);assert.equal(await pending,false);assert.equal(oldStream.track.stops,1);
  assert.equal(newStream.track.stops,0);assert.equal(h.media.state.mic.status,'active');
  assert.equal(h.intervals.size,1);assert.equal(h.contexts[1].closes,0);h.media.dispose();assert.equal(newStream.track.stops,1);
});
test('late denied permission does not overwrite newer microphone state',async()=>{
  const first=deferred();let requests=0;const h=harness('cores3',{getUserMedia:()=>++requests===1?first.promise:Promise.resolve(fakeStream())});
  const pending=h.media.enableMic();h.media.stopMic();await h.media.enableMic();
  first.reject(Object.assign(new Error('denied'),{name:'NotAllowedError'}));assert.equal(await pending,false);
  assert.equal(h.media.state.mic.status,'active');assert.equal(h.media.state.mic.error,null);h.media.dispose();
});
test('AudioContext resume occurs synchronously with the microphone enable gesture',async()=>{
  const request=deferred(),stream=fakeStream(),h=harness('cores3',{getUserMedia:()=>request.promise});
  const pending=h.media.enableMic();assert.equal(h.contexts.length,1);assert.equal(h.contexts[0].resumes,1);
  assert.equal(h.requests.length,1);assert.equal(h.media.state.mic.status,'requesting');
  request.resolve(stream);assert.equal(await pending,true);h.media.dispose();
});
test('stalled sound startup times out after five seconds and releases its context',async()=>{
  const resume=deferred(),h=harness('cores3',{resume:()=>resume.promise});const pending=h.media.enableSound();
  assert.equal([...h.timeouts.values()][0].ms,5000);h.expire();assert.equal(await pending,false);
  assert.equal(h.media.state.sound.status,'error');assert.equal(h.contexts[0].closes,1);assert.equal(h.timeouts.size,0);
  resume.resolve();await Promise.resolve();assert.equal(h.media.state.sound.enabled,false);h.media.dispose();
});
test('stalled microphone audio startup releases resources and late permission cannot begin capture',async()=>{
  const resume=deferred(),permission=deferred(),stream=fakeStream();
  const h=harness('cores3',{resume:()=>resume.promise,getUserMedia:()=>permission.promise});const pending=h.media.enableMic();
  h.expire();await Promise.resolve();assert.equal(h.media.state.mic.status,'error');assert.equal(h.contexts[0].closes,1);
  permission.resolve(stream);assert.equal(await pending,false);assert.equal(stream.track.stops,1);assert.equal(h.intervals.size,0);assert.equal(h.timeouts.size,0);
  resume.resolve();h.media.dispose();
});
test('render callbacks may cancel requesting, active, or enabling states without leaks',async()=>{
  for(const cancelState of ['requesting','active','enabling']){
    let h;h=harness('cores3',{onState:state=>{
      if(cancelState==='requesting' && state.mic.status==='requesting')h.media.stopMic();
      if(cancelState==='active' && state.mic.status==='active')h.media.stopMic();
      if(cancelState==='enabling' && state.sound.status==='enabling')h.media.muteSound();
    }});
    if(cancelState==='enabling')assert.equal(await h.media.enableSound(),false);
    else assert.equal(await h.media.enableMic(),false);
    assert.equal(h.intervals.size,0);assert.equal(h.timeouts.size,0);
    if(cancelState==='active')assert.equal(h.contexts[0].closes,1);
    else {assert.equal(h.contexts.length,0);assert.equal(h.requests.length,0);}
    h.media.dispose();
  }
});

test('an interrupted input context stops capture instead of forwarding frozen analyser samples',async()=>{
  const h=harness();await h.media.enableMic();h.tick();assert.equal(h.levels.at(-1).level,.5);
  h.contexts[0].state='suspended';h.tick();
  assert.equal(h.media.state.mic.status,'error');assert.equal(h.media.state.mic.level,0);assert.equal(h.levels.at(-1).level,0);
  assert.equal(h.intervals.size,0);assert.equal(h.contexts[0].sources[0].stream.track.stops,1);assert.equal(h.contexts[0].closes,1);h.media.dispose();
});
test('an interrupted output context mutes and requires a new explicit enable gesture',async()=>{
  const h=harness();await h.media.enableSound();h.contexts[0].state='suspended';
  assert.equal(h.media.testTone(),false);assert.equal(h.media.state.sound.enabled,false);assert.equal(h.media.state.sound.status,'error');assert.match(h.media.state.sound.error,/Enable sound/);
  assert.equal(h.contexts[0].oscillators.length,0);assert.equal(h.contexts[0].closes,1);h.media.dispose();
});

for(const target of ['mic','sound']){
  const action=target==='mic'?'enableMic':'enableSound';
  test(target+' context creation errors have a separate fixed stage and no exception detail',async()=>{
    const h=harness('cores3',{createAudioContext:()=>{throw Object.assign(new Error('private host internals'),{name:'NotAllowedError'});}});
    assert.equal(await h.media[action](),false);
    assert.equal(h.media.state[target].errorStage,'audio-context');assert.equal(h.media.state[target].errorCode,'AUDIO_CONTEXT_CREATE_FAILED');
    assert.ok(!JSON.stringify(h.states).includes('private host internals'));assert.equal(h.requests.length,0);h.media.dispose();
  });
  for(const [name,code] of [['NotAllowedError','AUDIO_RESUME_BLOCKED'],['SecurityError','AUDIO_RESUME_BLOCKED'],['UnknownError','AUDIO_RESUME_FAILED']]){
    test(target+' resume '+name+' is classified at audio startup, not microphone permission',async()=>{
      const stream=fakeStream(),h=harness('cores3',{getUserMedia:()=>Promise.resolve(stream),resume:()=>Promise.reject(Object.assign(new Error('private message'),{name}))});
      assert.equal(await h.media[action](),false);const state=h.media.state[target];
      assert.equal(state.errorStage,'audio-resume');assert.equal(state.errorCode,code);assert.doesNotMatch(state.error,/microphone|permission was denied/i);
      assert.ok(!JSON.stringify(h.states).includes('private message'));assert.equal(h.contexts[0].closes,1);assert.equal(h.timeouts.size,0);
      assert.equal(stream.track.stops,target==='mic'?1:0);assert.equal(h.requests.length,target==='mic'?1:0);h.media.dispose();
    });
  }
  test(target+' fulfilled resume without running state is distinguishable from rejection',async()=>{
    const context={state:'suspended',closes:0,resume:()=>Promise.resolve(),close(){this.closes++;this.state='closed';}};
    const h=harness('cores3',{createAudioContext:()=>context});
    assert.equal(await h.media[action](),false);assert.equal(h.media.state[target].errorCode,'AUDIO_RESUME_NOT_RUNNING');
    assert.equal(context.closes,1);assert.equal(h.timeouts.size,0);h.media.dispose();
  });
  test(target+' stalled resume has a fixed timeout diagnostic and ignores late completion',async()=>{
    const resume=deferred(),h=harness('cores3',{resume:()=>resume.promise});const pending=h.media[action]();
    h.expire();assert.equal(await pending,false);assert.equal(h.media.state[target].errorCode,'AUDIO_RESUME_TIMEOUT');
    assert.equal(h.media.state[target].errorStage,'audio-resume');resume.resolve();await Promise.resolve();await Promise.resolve();
    assert.equal(h.media.state[target].errorCode,'AUDIO_RESUME_TIMEOUT');assert.equal(h.contexts[0].closes,1);h.media.dispose();
  });
  test(target+' context factory cancellation closes the returned context without reviving action',async()=>{
    const context={closes:0,resumes:0,close(){this.closes++;},resume(){this.resumes++;return Promise.resolve();}};
    let h;h=harness('cores3',{createAudioContext:()=>{h.media.setSession('replacement-session');return context;}});
    assert.equal(await h.media[action](),false);assert.equal(context.closes,1);assert.equal(context.resumes,0);assert.equal(h.requests.length,0);
    assert.equal(h.media.state.sessionId,'replacement-session');assert.equal(h.media.state[target].errorCode,null);h.media.dispose();
  });
  test(target+' error cleanup cannot overwrite a new action started by its state callback',async()=>{
    let h,replacement,attempt=0;
    h=harness('cores3',{
      resume:()=>++attempt===1?Promise.reject(new Error('first context failed')):Promise.resolve(),
      onState:state=>{
        if(attempt===1 && (target==='mic'?state.mic.status==='off'&&state.mic.reason==='start-error':state.sound.status==='muted')){
          replacement=h.media[action]();
        }
      },
    });
    assert.equal(await h.media[action](),false);assert.equal(await replacement,true);
    assert.equal(h.media.state[target].status,target==='mic'?'active':'ready');assert.equal(h.media.state[target].errorCode,null);
    assert.equal(h.contexts[0].closes,1);assert.equal(h.contexts[1].closes,0);h.media.dispose();
  });
}

for(const [name,code] of [['NotAllowedError','MICROPHONE_BLOCKED'],['SecurityError','MICROPHONE_BLOCKED'],['NotFoundError','MICROPHONE_NOT_FOUND'],['DevicesNotFoundError','MICROPHONE_NOT_FOUND'],['NotReadableError','MICROPHONE_BUSY'],['TrackStartError','MICROPHONE_BUSY'],['UnknownError','MICROPHONE_REQUEST_FAILED']]){
  test('microphone request '+name+' uses a fixed diagnostic without exposing host data',async()=>{
    const h=harness('cores3',{getUserMedia:()=>Promise.reject(Object.assign(new Error('secret host detail'),{name}))});
    assert.equal(await h.media.enableMic(),false);assert.equal(h.media.state.mic.errorCode,code);assert.equal(h.media.state.mic.errorStage,'microphone-access');
    assert.ok(!JSON.stringify(h.states).includes('secret host detail'));assert.equal(h.contexts[0].closes,1);h.media.dispose();
  });
}
test('missing getUserMedia is distinguished from context construction and does not create audio',async()=>{
  const h=harness('cores3',{unavailable:true});assert.equal(await h.media.enableMic(),false);
  assert.equal(h.media.state.mic.status,'unavailable');assert.equal(h.media.state.mic.errorCode,'MICROPHONE_UNAVAILABLE');assert.equal(h.contexts.length,0);h.media.dispose();
});
test('ended microphone stream is rejected with a live-track diagnostic and stopped once',async()=>{
  const stream=fakeStream();stream.track.readyState='ended';const h=harness('cores3',{getUserMedia:()=>Promise.resolve(stream)});
  assert.equal(await h.media.enableMic(),false);assert.equal(h.media.state.mic.errorCode,'MICROPHONE_NO_LIVE_TRACK');assert.equal(stream.track.stops,1);h.media.dispose();
});
test('level graph construction failure is distinct from microphone permission',async()=>{
  let h;h=harness('cores3',{getUserMedia:()=>{h.contexts[0].createAnalyser=()=>{throw new Error('private setup failure');};return Promise.resolve(fakeStream());}});
  assert.equal(await h.media.enableMic(),false);assert.equal(h.media.state.mic.errorCode,'MICROPHONE_INPUT_SETUP_FAILED');assert.equal(h.media.state.mic.errorStage,'microphone-input');
  assert.ok(!JSON.stringify(h.states).includes('private setup failure'));assert.equal(h.contexts[0].closes,1);h.media.dispose();
});
test('context resume reentrancy prevents the following microphone permission request',async()=>{
  let h;h=harness('cores3',{resume:()=>{h.media.setSession('session-after-resume');return Promise.resolve();}});
  assert.equal(await h.media.enableMic(),false);assert.equal(h.requests.length,0);assert.equal(h.contexts[0].closes,1);
  assert.equal(h.media.state.mic.status,'off');assert.equal(h.media.state.mic.errorCode,null);h.media.dispose();
});
test('getUserMedia getter reentrancy is fenced before context creation or permission',async()=>{
  const h=harness();h.media._mediaDevices={get getUserMedia(){h.media.setSession('session-after-getter');return ()=>{throw new Error('permission must not be requested');};}};
  assert.equal(await h.media.enableMic(),false);assert.equal(h.contexts.length,0);assert.equal(h.media.state.mic.status,'off');h.media.dispose();
});
test('retries clear old diagnostics and successful enable sound remains silent',async()=>{
  let attempt=0;const h=harness('cores3',{resume:()=>++attempt===1?Promise.reject(new Error('first')):Promise.resolve()});
  assert.equal(await h.media.enableSound(),false);assert.equal(h.media.state.sound.errorCode,'AUDIO_RESUME_FAILED');
  assert.equal(await h.media.enableSound(),true);assert.equal(h.media.state.sound.errorCode,null);assert.equal(h.media.state.sound.errorStage,null);assert.equal(h.media.state.sound.error,null);
  assert.equal(h.contexts[1].oscillators.length,0);h.media.dispose();
});

for(const target of ['mic','sound']){
  const action=target==='mic'?'enableMic':'enableSound';
  test(target+' resume is invoked in the calling turn and snapshots activation at that call',async()=>{
    const order=[],activation={isActive:true};
    const h=harness('cores3',{userActivation:activation,resume:()=>{order.push('resume');assert.equal(activation.isActive,true);}});
    const pending=h.media[action]();order.push('returned');activation.isActive=false;
    assert.deepEqual(order,['resume','returned']);assert.equal(h.media.state[target].resumeDiagnostic.userActivation,true);
    assert.equal(await pending,true);const diagnostic=h.media.state[target].resumeDiagnostic;
    assert.deepEqual(diagnostic,{attempt:1,outcome:'resolved',initialState:'suspended',finalState:'running',errorName:null,userActivation:true});
    assert.equal(Object.isFrozen(diagnostic),true);assert.throws(()=>{diagnostic.outcome='invented';},TypeError);h.media.dispose();
  });
  for(const kind of ['rejected','threw']){
    test(target+' '+kind+' resume retains allowlisted name and pre-cleanup context states',async()=>{
      const error=Object.assign(new Error('private browser message'),{name:'InvalidStateError'});
      const context={state:'suspended',close(){this.state='closed';},resume(){this.state='interrupted';if(kind==='threw')throw error;return Promise.reject(error);}};
      const h=harness('cores3',{createAudioContext:()=>context,userActivation:{isActive:false}});
      assert.equal(await h.media[action](),false);
      assert.deepEqual(h.media.state[target].resumeDiagnostic,{attempt:1,outcome:kind,initialState:'suspended',finalState:'interrupted',errorName:'InvalidStateError',userActivation:false});
      assert.equal(context.state,'closed');assert.equal(h.media.state[target].errorCode,'AUDIO_RESUME_FAILED');
      assert.ok(!JSON.stringify(h.media.state).includes('private browser message'));h.media.dispose();
    });
  }
  test(target+' timeout reports the actual final state without attributing a host exception',async()=>{
    const resume=deferred(),h=harness('cores3',{resume:()=>resume.promise});const pending=h.media[action]();h.expire();assert.equal(await pending,false);
    assert.deepEqual(h.media.state[target].resumeDiagnostic,{attempt:1,outcome:'timed-out',initialState:'suspended',finalState:'suspended',errorName:null,userActivation:null});
    const snapshot=h.media.state[target].resumeDiagnostic;resume.reject(Object.assign(new Error('late private'),{name:'SecurityError'}));await Promise.resolve();await Promise.resolve();
    assert.equal(h.media.state[target].resumeDiagnostic,snapshot);h.media.dispose();
  });
  test(target+' fulfilled but suspended resume is a resolved call with a non-running failure',async()=>{
    const context={state:'suspended',resume:()=>Promise.resolve(),close(){this.state='closed';}};
    const h=harness('cores3',{createAudioContext:()=>context});assert.equal(await h.media[action](),false);
    assert.equal(h.media.state[target].resumeDiagnostic.outcome,'resolved');assert.equal(h.media.state[target].resumeDiagnostic.finalState,'suspended');
    assert.equal(h.media.state[target].errorCode,'AUDIO_RESUME_NOT_RUNNING');h.media.dispose();
  });
  test(target+' cancellation and newer attempt cannot inherit a late resume diagnostic',async()=>{
    const old=deferred();let attempts=0;const h=harness('cores3',{resume:()=>++attempts===1?old.promise:Promise.resolve()});
    const pending=h.media[action]();const oldSnapshot=h.media.state[target].resumeDiagnostic;
    h.media.setSession('new-session');assert.equal(h.media.state[target].resumeDiagnostic,null);
    assert.equal(await pending,false);assert.equal(await h.media[action](),true);const snapshot=h.media.state[target].resumeDiagnostic;
    assert.ok(snapshot.attempt>oldSnapshot.attempt);assert.equal(snapshot.outcome,'resolved');
    old.reject(Object.assign(new Error('old detail'),{name:'NotAllowedError'}));await Promise.resolve();await Promise.resolve();
    assert.equal(h.media.state[target].resumeDiagnostic,snapshot);h.media.dispose();assert.equal(h.media.state[target].resumeDiagnostic,null);
  });
}
for(const name of ['NotAllowedError','SecurityError','NotSupportedError','AbortError','OperationError','TypeError','Error','private-1234-token']){
  test('resume error name is restricted to an explicit allowlist: '+name,async()=>{
    const h=harness('cores3',{resume:()=>Promise.reject(Object.assign(new Error('private error body'),{name}))});assert.equal(await h.media.enableSound(),false);
    assert.equal(h.media.state.sound.resumeDiagnostic.errorName,name==='private-1234-token'?'OtherError':name);
    assert.ok(!JSON.stringify(h.media.state).includes('private'));h.media.dispose();
  });
}
test('missing, malformed and throwing activation observations remain unknown',async()=>{
  for(const userActivation of [undefined,null,{isActive:'true'},{get isActive(){throw new Error('private activation error');}}]){
    const h=harness('cores3',{userActivation});assert.equal(await h.media.enableSound(),true);
    assert.equal(h.media.state.sound.resumeDiagnostic.userActivation,null);h.media.dispose();
  }
});
test('activation getter cancellation prevents resume and microphone permission',async()=>{
  let h;h=harness('cores3',{userActivation:{get isActive(){h.media.setSession('cancelled-before-resume');return true;}}});
  assert.equal(await h.media.enableMic(),false);assert.equal(h.contexts[0].resumes,0);assert.equal(h.requests.length,0);
  assert.equal(h.contexts[0].closes,1);assert.equal(h.timeouts.size,0);assert.equal(h.media.state.mic.resumeDiagnostic,null);h.media.dispose();
});
test('a rejected resume with no rejection reason still fails and cannot falsely enable sound',async()=>{
  const context={state:'suspended',resume:()=>Promise.reject(undefined),close(){this.state='closed';}};
  const h=harness('cores3',{createAudioContext:()=>context});assert.equal(await h.media.enableSound(),false);
  assert.equal(h.media.state.sound.enabled,false);assert.equal(h.media.state.sound.errorCode,'AUDIO_RESUME_FAILED');
  assert.equal(h.media.state.sound.resumeDiagnostic.outcome,'rejected');assert.equal(h.media.state.sound.resumeDiagnostic.errorName,null);h.media.dispose();
});
test('a throwing resume property preserves its observed initial state',async()=>{
  const context={state:'suspended',get resume(){throw new TypeError('private method detail');},close(){this.state='closed';}};
  const h=harness('cores3',{createAudioContext:()=>context});assert.equal(await h.media.enableSound(),false);
  assert.deepEqual(h.media.state.sound.resumeDiagnostic,{attempt:1,outcome:'threw',initialState:'suspended',finalState:'suspended',errorName:'TypeError',userActivation:null});h.media.dispose();
});
test('unrecognized context state and a throwing error-name getter cannot leak host details',async()=>{
  const error={get name(){throw new Error('private exception name');}};
  const context={state:'private context state',resume:()=>Promise.reject(error),close(){this.state='closed';}};
  const h=harness('cores3',{createAudioContext:()=>context});assert.equal(await h.media.enableSound(),false);
  assert.deepEqual(h.media.state.sound.resumeDiagnostic,{attempt:1,outcome:'rejected',initialState:'unknown',finalState:'unknown',errorName:'OtherError',userActivation:null});
  assert.ok(!JSON.stringify(h.media.state).includes('private'));h.media.dispose();
});

test('microphone request and resume retain the original gesture and emit settled resume while permission waits',async()=>{
  const request=deferred(),order=[],activation={isActive:true};
  const h=harness('cores3se',{userActivation:activation,resume:()=>order.push('resume'),getUserMedia:()=>{
    order.push('request');assert.equal(activation.isActive,true);return request.promise;
  }});
  const pending=h.media.enableMic();order.push('returned');activation.isActive=false;
  assert.deepEqual(order,['resume','request','returned']);
  assert.deepEqual(h.media.state.mic.accessDiagnostic,{attempt:1,outcome:'pending',errorName:null,userActivation:true});
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  const emitted=h.states.at(-1).mic;
  assert.equal(emitted.status,'requesting');assert.equal(emitted.resumeDiagnostic.outcome,'resolved');
  assert.equal(emitted.resumeDiagnostic.finalState,'running');assert.equal(emitted.accessDiagnostic.outcome,'pending');
  assert.deepEqual([...h.timeouts.values()].map(value=>value.ms),[30000]);
  h.media.stopMic();assert.equal(await pending,false);request.resolve(fakeStream());await Promise.resolve();h.media.dispose();
});

test('microphone permission wait ends after 30 seconds even when the host promise never settles',async()=>{
  const request=deferred(),h=harness('cores3se',{getUserMedia:()=>request.promise});
  const pending=h.media.enableMic();await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.deepEqual([...h.timeouts.values()].map(value=>value.ms),[30000]);
  h.expire();assert.equal(await pending,false);
  const state=h.media.state.mic;
  assert.equal(state.status,'error');assert.equal(state.errorCode,'MICROPHONE_REQUEST_TIMEOUT');
  assert.equal(state.errorStage,'microphone-access');assert.equal(state.resumeDiagnostic.outcome,'resolved');
  assert.deepEqual(state.accessDiagnostic,{attempt:1,outcome:'timed-out',errorName:null,userActivation:null});
  assert.equal(h.contexts[0].closes,1);assert.equal(h.timeouts.size,0);assert.equal(h.intervals.size,0);
  const late=fakeStream();request.resolve(late);await Promise.resolve();
  assert.equal(late.track.stops,1);assert.equal(h.media.state.mic.accessDiagnostic,state.accessDiagnostic);h.media.dispose();
});

test('a delayed timer cannot admit microphone permission granted beyond its deadline',async()=>{
  const request=deferred(),stream=fakeStream();let now=100;
  const h=harness('cores3se',{now:()=>now,getUserMedia:()=>request.promise});
  const pending=h.media.enableMic();now=30100;request.resolve(stream);
  assert.equal(await pending,false);assert.equal(stream.track.stops,1);
  assert.equal(h.media.state.mic.errorCode,'MICROPHONE_REQUEST_TIMEOUT');assert.equal(h.timeouts.size,0);
  assert.equal(h.contexts[0].sources.length,0);h.media.dispose();
});

for(const outcome of ['rejected','threw']){
  for(const [name,code] of [['NotAllowedError','MICROPHONE_BLOCKED'],['SecurityError','MICROPHONE_BLOCKED'],
    ['NotFoundError','MICROPHONE_NOT_FOUND'],['NotReadableError','MICROPHONE_BUSY'],
    ['TypeError','MICROPHONE_REQUEST_FAILED'],['OverconstrainedError','MICROPHONE_REQUEST_FAILED'],
    ['private-device-identifier','MICROPHONE_REQUEST_FAILED']]){
    test('microphone '+outcome+' request safely reports '+name,async()=>{
      const error=Object.assign(new Error('private microphone details'),{name,deviceId:'private-device-id',constraint:'private-constraint'});
      const h=harness('cores3se',{userActivation:{isActive:true},getUserMedia:()=>{
        if(outcome==='threw')throw error;return Promise.reject(error);
      }});
      assert.equal(await h.media.enableMic(),false);
      const state=h.media.state.mic;
      assert.equal(state.errorCode,code);assert.equal(state.errorStage,'microphone-access');
      assert.deepEqual(state.accessDiagnostic,{attempt:1,outcome,errorName:name.startsWith('private')?'OtherError':name,userActivation:true});
      assert.equal(Object.isFrozen(state.accessDiagnostic),true);
      assert.throws(()=>{state.accessDiagnostic.outcome='invented';},TypeError);
      state.accessDiagnostic=null;assert.notEqual(h.media.state.mic.accessDiagnostic,null);
      assert.doesNotMatch(JSON.stringify(h.states),/private/);assert.equal(h.timeouts.size,0);h.media.dispose();
    });
  }
}

test('microphone request diagnostics handle a throwing error-name getter and absent rejection reason',async()=>{
  for(const error of [{get name(){throw new Error('private getter detail');}},undefined]){
    const h=harness('cores3se',{getUserMedia:()=>Promise.reject(error)});
    assert.equal(await h.media.enableMic(),false);assert.equal(h.media.state.mic.errorCode,'MICROPHONE_REQUEST_FAILED');
    assert.equal(h.media.state.mic.accessDiagnostic.errorName,error?'OtherError':null);
    assert.equal(h.media.state.mic.accessDiagnostic.outcome,'rejected');
    assert.doesNotMatch(JSON.stringify(h.states),/private/);h.media.dispose();
  }
});

test('settled microphone request diagnostics are emitted and contain no stream information',async()=>{
  const stream=fakeStream();stream.track.label='private microphone';stream.track.deviceId='private-id';
  const h=harness('cores3se',{getUserMedia:()=>Promise.resolve(stream)});
  assert.equal(await h.media.enableMic(),true);
  const diagnostic=h.media.state.mic.accessDiagnostic;
  assert.deepEqual(diagnostic,{attempt:1,outcome:'resolved',errorName:null,userActivation:null});
  assert.equal(Object.isFrozen(diagnostic),true);
  assert.ok(h.states.some(state=>state.mic.status==='requesting'&&state.mic.accessDiagnostic?.outcome==='resolved'));
  assert.doesNotMatch(JSON.stringify(h.states),/private/);h.media.dispose();
});

test('a diagnostic render callback can cancel before a granted stream is adopted',async()=>{
  const stream=fakeStream();let h;
  h=harness('cores3se',{getUserMedia:()=>Promise.resolve(stream),onState:state=>{
    if(state.mic.status==='requesting'&&state.mic.accessDiagnostic?.outcome==='resolved')h.media.stopMic('render-cancel');
  }});
  assert.equal(await h.media.enableMic(),false);assert.equal(stream.track.stops,1);
  assert.equal(h.contexts[0].sources.length,0);assert.equal(h.contexts[0].closes,1);
  assert.equal(h.timeouts.size,0);h.media.dispose();
});

test('a settled resume notification can cancel a pending microphone request without waiting for permission',async()=>{
  const request=deferred();let h;
  h=harness('cores3se',{getUserMedia:()=>request.promise,onState:state=>{
    if(state.mic.status==='requesting'&&state.mic.resumeDiagnostic?.outcome==='resolved')h.media.stopMic('render-cancel');
  }});
  assert.equal(await h.media.enableMic(),false);
  assert.equal(h.media.state.mic.accessDiagnostic.outcome,'cancelled');assert.equal(h.timeouts.size,0);
  const late=fakeStream();request.resolve(late);await Promise.resolve();assert.equal(late.track.stops,1);h.media.dispose();
});

test('microphone access cancellation from the activation getter prevents requesting permission',async()=>{
  let h,reads=0;h=harness('cores3se',{userActivation:{get isActive(){
    if(++reads===2)h.media.setSession('cancel-before-request');return true;
  }}});
  assert.equal(await h.media.enableMic(),false);assert.equal(h.requests.length,0);
  assert.equal(h.contexts[0].closes,1);assert.equal(h.timeouts.size,0);h.media.dispose();
});

test('late rejected microphone promises after cancellation or timeout are handled and cannot replace a retry',async()=>{
  const unhandled=[];const onUnhandled=error=>unhandled.push(error);process.on('unhandledRejection',onUnhandled);
  try{
    for(const reason of ['cancel','timeout']){
      const first=deferred();let requests=0;
      const h=harness('cores3se',{getUserMedia:()=>++requests===1?first.promise:Promise.resolve(fakeStream())});
      const pending=h.media.enableMic();await Promise.resolve();await Promise.resolve();await Promise.resolve();
      if(reason==='cancel')h.media.stopMic();else h.expire();
      assert.equal(await pending,false);assert.equal(await h.media.enableMic(),true);
      const snapshot=h.media.state.mic.accessDiagnostic;
      first.reject(Object.assign(new Error('private late failure'),{name:'NotAllowedError'}));
      await new Promise(resolve=>setImmediate(resolve));
      assert.equal(h.media.state.mic.status,'active');assert.equal(h.media.state.mic.accessDiagnostic,snapshot);
      assert.equal(h.media.state.mic.errorCode,null);h.media.dispose();
    }
    assert.deepEqual(unhandled,[]);
  }finally{process.removeListener('unhandledRejection',onUnhandled);}
});
