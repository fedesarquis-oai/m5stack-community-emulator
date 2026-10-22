import test from 'node:test';
import assert from 'node:assert/strict';
import {DeviceMedia} from '../device-media.mjs';
import {speakerFrames} from '../speaker-pcm.mjs';
import {WorkbenchController} from '../controller.mjs';
const packet=(update={})=>({generation:1,sequence:1,sample_rate:16000,channels:1,first_frame:0,total_frames:16000,active:true,pcm_s16le:Buffer.from([0,128,0,0,255,127]).toString('base64'),...update});
function harness(){
 const buffers=[],sources=[],gains=[],listeners={},contextListeners=new Set();
 const document={hidden:false,addEventListener:(n,f)=>listeners[n]=f,removeEventListener(){}};
 const ctx={state:'running',currentTime:0,destination:{},resumes:0,closes:0,
 resume:async()=>{ctx.resumes++;ctx.state='running';},close:async()=>{ctx.closes++;ctx.state='closed';},
 addEventListener:(name,listener)=>{assert.equal(name,'statechange');contextListeners.add(listener);},
 removeEventListener:(name,listener)=>{assert.equal(name,'statechange');contextListeners.delete(listener);},
 createBuffer:(c,n,r)=>{const data=new Float32Array(n);const b={c,n,r,data,getChannelData:()=>data};buffers.push(b);return b;},
 createGain:()=>{const g={gain:{setValueAtTime(v){g.volume=v;}},connect(){},disconnect(){}};gains.push(g);return g;},
 createBufferSource:()=>{const s={connect(){},disconnect(){},start(t){s.at=t;},stop(){s.stopped=true;}};sources.push(s);return s;}};
 const media=new DeviceMedia({profileId:'cores3se',sessionId:'session',document,window:null,createAudioContext:()=>ctx});
 return {media,ctx,buffers,sources,gains,document,listeners,contextListeners,interrupt(state){ctx.state=state;for(const listener of [...contextListeners])listener();}};
}
test('PCM signed little endian reaches AudioBuffer exactly, with sample rate and current gain',async()=>{
 const h=harness();await h.media.enableSound();assert.equal(h.media.acceptAppPcm({sessionId:'session',packet:packet()}),true);
 assert.deepEqual([...h.buffers[0].data],[-1,0,32767/32768]);assert.equal(h.buffers[0].r,16000);
 assert.equal(h.sources[0].at,0.03);assert.equal(h.gains[0].volume,0.35);
 h.media.setVolume(.12);assert.equal(h.gains[0].volume,.12);assert.equal(h.sources[0].stopped,undefined);h.media.dispose();
});
test('muted, repeated, stale session and stale generation packets cannot replay',async()=>{
 const h=harness(),feed=(p,s='session')=>h.media.acceptAppPcm({sessionId:s,packet:p});
 assert.equal(feed(packet()),false);await h.media.enableSound();assert.equal(feed(packet()),false);
 assert.equal(feed(packet({sequence:2,first_frame:3}),'old'),false);
 assert.equal(feed(packet({sequence:2,first_frame:3})),true);
 assert.equal(feed(packet({generation:0,sequence:3})),false);assert.equal(h.sources.length,1);h.media.dispose();
});
test('contiguous chunks schedule gaplessly and bounded queues reject flooding',async()=>{
 const h=harness();await h.media.enableSound();const data=Buffer.alloc(8000).toString('base64');
 for(let i=0;i<3;i++)assert.equal(h.media.acceptAppPcm({sessionId:'session',packet:packet({sequence:i+1,first_frame:i*4000,pcm_s16le:data})}),true);
 assert.deepEqual(h.sources.map(s=>s.at),[.03,.28,.53]);
 assert.equal(h.media.acceptAppPcm({sessionId:'session',packet:packet({sequence:4,first_frame:12000,pcm_s16le:data})}),false);h.media.dispose();
});
test('app stop/replacement, mute, hide and session changes release scheduled output',async()=>{
 for(const action of [h=>h.media.acceptAppPcm({sessionId:'session',packet:packet({generation:2,sequence:0,total_frames:0,active:false,pcm_s16le:''})}),h=>h.media.muteSound(),h=>{h.document.hidden=true;h.listeners.visibilitychange();},h=>h.media.setSession('new')]){
  const h=harness();await h.media.enableSound();h.media.acceptAppPcm({sessionId:'session',packet:packet()});action(h);assert.equal(h.sources[0].stopped,true);assert.equal(h.media.state.sound.pcmQueued,0);h.media.dispose();
 }
});
test('invalid packet formats, rates, bytes, offsets and non-speaker profile are rejected',async()=>{
 for(const update of [{sample_rate:7999},{sample_rate:48001},{channels:2},{first_frame:-1},{pcm_s16le:'AA=='},{pcm_s16le:'!!!!!'},{pcm_s16le:Buffer.alloc(8002).toString('base64')},{total_frames:2},{active:false},{unexpected:true}])assert.equal(speakerFrames(packet(update)),-1);
 const h=harness();h.media.setProfile('stickcplus2');h.media.setSession('session');await h.media.enableSound();assert.equal(h.media.acceptAppPcm({sessionId:'session',packet:packet()}),false);h.media.dispose();
});
test('audio keeps frame polling during a held gesture, and returns to idle interval afterwards',()=>{
 const delays=[];const c=new WorkbenchController({call:async()=>{},schedule:(_,n)=>{delays.push(n);return 1;},cancel:()=>{}});
 c.state={sessionId:'s',status:'running',capabilities:{speakerPcm:true},nativeState:{speaker_output:{active:true}}};c.holdPolling(true);assert.equal(delays.at(-1),80);
 c.holdPolling(true,'decode');const n=delays.length;c.armPoll();assert.equal(delays.length,n);c.state.nativeState.speaker_output.active=false;c.holdPolling(false);c.holdPolling(false,'decode');assert.equal(delays.at(-1),750);c.dispose();
});

for(const state of ['suspended','interrupted','closed'])test(`final one-packet clip is released immediately on ${state}, without another packet or control`,async()=>{
 const h=harness();await h.media.enableSound();
 assert.equal(h.media.acceptAppPcm({sessionId:'session',packet:packet({total_frames:3})}),true);
 const oldListener=[...h.contextListeners][0];
 h.interrupt(state);
 assert.equal(h.media.state.sound.enabled,false);
 assert.equal(h.media.state.sound.errorCode,'SOUND_INTERRUPTED');
 assert.equal(h.media.state.sound.pcmQueued,0);assert.equal(h.sources[0].stopped,true);
 assert.equal(h.ctx.closes,1);assert.equal(h.contextListeners.size,0);
 h.ctx.state='running'; // Host recovery alone must not enable playback.
 assert.equal(h.media.acceptAppPcm({sessionId:'session',packet:packet({total_frames:3})}),false);
 assert.equal(h.ctx.resumes,1);assert.equal(h.sources.length,1);
 assert.equal(await h.media.enableSound(),true); // Represents the new explicit Enable action.
 oldListener?.();assert.equal(h.media.state.sound.enabled,true);
 assert.equal(h.media.acceptAppPcm({sessionId:'session',packet:packet({generation:2,total_frames:3})}),true);
 h.media.dispose();assert.equal(h.contextListeners.size,0);
});
test('empty completion and repeated PCM also detect interruption if statechange is delayed',async()=>{
 for(const final of [packet({sequence:1,first_frame:3,total_frames:3,active:false,pcm_s16le:''}),packet({total_frames:3})]){
  const h=harness();await h.media.enableSound();h.media.acceptAppPcm({sessionId:'session',packet:packet({total_frames:3})});
  h.ctx.state='suspended';
  assert.equal(h.media.acceptAppPcm({sessionId:'session',packet:final}),false);
  assert.equal(h.media.state.sound.enabled,false);assert.equal(h.media.state.sound.errorCode,'SOUND_INTERRUPTED');
  assert.equal(h.sources[0].stopped,true);assert.equal(h.media.state.sound.pcmQueued,0);h.media.dispose();
 }
});
