import {speakerFrames} from './speaker-pcm.mjs';
// Host audio output and legacy level adapter; live microphone PCM uses its own adapter.
import {DEVICE_MEDIA_CAPABILITIES} from './device-profiles.mjs';
export {DEVICE_MEDIA_CAPABILITIES};
const NO_MEDIA = Object.freeze({microphone:false,audioOutput:'none'});
const MIC_INTERVAL_MS = 200;
const AUDIO_START_TIMEOUT_MS = 5000;
const MICROPHONE_REQUEST_TIMEOUT_MS = 30000;
const MAX_TONE_MS = 1000;
const MAX_GAIN = 0.06;
const noop = () => {};

export function mediaCapabilities(profileId){
  return Object.hasOwn(DEVICE_MEDIA_CAPABILITIES,profileId)?DEVICE_MEDIA_CAPABILITIES[profileId]:NO_MEDIA;
}
export function normalizedRms(samples){
  if(!samples?.length)return 0;
  let squares=0;
  for(const sample of samples){
    const bounded=Number.isFinite(sample)?Math.max(-1,Math.min(1,sample)):0;
    squares+=bounded*bounded;
  }
  return Math.max(0,Math.min(1,Math.sqrt(squares/samples.length)));
}
function normalizeTone(tone){
  if(!tone || !Number.isFinite(tone.frequencyHz) || tone.frequencyHz<20 || tone.frequencyHz>20000 || !Number.isFinite(tone.durationMs) || tone.durationMs<=0)return null;
  return {frequencyHz:tone.frequencyHz,durationMs:Math.min(MAX_TONE_MS,tone.durationMs)};
}
function safely(callback,...args){try{return callback(...args);}catch{return undefined;}}
function stopStream(stream){for(const track of stream?.getTracks?.()??[])safely(()=>track.stop());}
function closeContext(context){
  if(context)safely(()=>Promise.resolve(context.close()).catch(noop));
}
// Only fixed diagnostics cross the rendering boundary, never host exception text.
const DIAGNOSTICS = Object.freeze({
  AUDIO_CONTEXT_UNAVAILABLE:['audio-context','Audio processing is unavailable in this host.'],
  AUDIO_CONTEXT_CREATE_FAILED:['audio-context','The host could not create an audio context.'],
  AUDIO_RESUME_BLOCKED:['audio-resume','The host blocked audio startup. Try again from the Enable control.'],
  AUDIO_RESUME_FAILED:['audio-resume','The host could not resume audio processing.'],
  AUDIO_RESUME_TIMEOUT:['audio-resume','Audio startup did not finish within five seconds. Try the Enable control again.'],
  AUDIO_RESUME_NOT_RUNNING:['audio-resume','Audio processing did not enter a running state. Try the Enable control again.'],
  MICROPHONE_UNAVAILABLE:['microphone-access','Microphone access is unavailable in this host.'],
  MICROPHONE_BLOCKED:['microphone-access','Microphone access was denied by the app or system. Check microphone permissions; this host may block plugin recording.'],
  MICROPHONE_NOT_FOUND:['microphone-access','No microphone is available.'],
  MICROPHONE_BUSY:['microphone-access','The microphone is busy or unavailable.'],
  MICROPHONE_REQUEST_FAILED:['microphone-access','The host could not open the microphone.'],
  MICROPHONE_REQUEST_TIMEOUT:['microphone-access','Microphone access did not finish within 30 seconds. Check the permission prompt, then enable the microphone again.'],
  MICROPHONE_NO_LIVE_TRACK:['microphone-access','The microphone returned no live audio track.'],
  MICROPHONE_INPUT_SETUP_FAILED:['microphone-input','Microphone level processing could not be started.'],
  MICROPHONE_INPUT_INTERRUPTED:['microphone-input','Microphone audio processing was interrupted. Enable the microphone again.'],
  MICROPHONE_INPUT_FAILED:['microphone-input','Microphone level input stopped unexpectedly.'],
  SOUND_INTERRUPTED:['audio-output','Sound was interrupted. Enable sound to resume.'],
  SOUND_PLAYBACK_FAILED:['audio-output','App audio could not be played.'],
});
class MediaFailure extends Error{constructor(code){super(code);this.code=code;}}
function diagnostic(code){const [errorStage,error]=DIAGNOSTICS[code];return {errorStage,errorCode:code,error};}
function errorName(error){return safely(()=>error?.name);}
const RESUME_ERROR_NAMES=new Set(['Error','TypeError','RangeError','NotAllowedError','SecurityError','InvalidStateError','NotSupportedError','AbortError','OperationError','UnknownError']);
const ACCESS_ERROR_NAMES=new Set([...RESUME_ERROR_NAMES,'NotFoundError','DevicesNotFoundError','NotReadableError','TrackStartError','OverconstrainedError','ConstraintNotSatisfiedError','PermissionDeniedError']);
function resumeErrorName(error){
  if(!error || error instanceof MediaFailure)return null;
  const name=errorName(error);return RESUME_ERROR_NAMES.has(name)?name:'OtherError';
}
function accessErrorName(error){
  if(!error || error instanceof MediaFailure)return null;
  const name=errorName(error);return ACCESS_ERROR_NAMES.has(name)?name:'OtherError';
}
function contextState(context){
  const state=safely(()=>context.state);
  return ['running','suspended','closed','interrupted'].includes(state)?state:'unknown';
}
function resumeCode(error){
  if(error instanceof MediaFailure && Object.hasOwn(DIAGNOSTICS,error.code))return error.code;
  return ['NotAllowedError','SecurityError'].includes(errorName(error))?'AUDIO_RESUME_BLOCKED':'AUDIO_RESUME_FAILED';
}
function micCode(error){
  const name=errorName(error);
  if(name==='NotAllowedError' || name==='SecurityError')return 'MICROPHONE_BLOCKED';
  if(name==='NotFoundError' || name==='DevicesNotFoundError')return 'MICROPHONE_NOT_FOUND';
  if(name==='NotReadableError' || name==='TrackStartError')return 'MICROPHONE_BUSY';
  return 'MICROPHONE_REQUEST_FAILED';
}

/**
 * Constructing this adapter never activates media. enableMic() and enableSound()
 * must be called directly from explicit user actions. No microphone monitoring
 * reaches the audio destination. Tone output is muted until enableSound().
 *
 * Call setSession() whenever the native session OR app generation changes, and
 * feed every current app/diagnostic cue snapshot to acceptAppTone(), including
 * when muted. cueId is a monotonic nonnegative integer per session and channel;
 * the first snapshot establishes a silent baseline. Old sessions and repeated
 * or out-of-order snapshots are ignored. testTone() is a separate local action.
 *
 * onMicLevel(level,{profileId,sessionId}) receives a bounded 0..1 RMS envelope,
 * including zero when live input stops. It does not receive audio samples.
 * onState and the .state getter expose detached state snapshots for rendering.
 * Inject mediaDevices, createAudioContext, document, window and timers in tests.
 */
export class DeviceMedia {
  constructor({profileId='atoms3r',sessionId=null,onState=noop,onMicLevel=noop,
    mediaDevices=globalThis.navigator?.mediaDevices,
    userActivation=globalThis.navigator?.userActivation,
    createAudioContext=()=>{const Context=globalThis.AudioContext??globalThis.webkitAudioContext;if(!Context)throw new MediaFailure('AUDIO_CONTEXT_UNAVAILABLE');return new Context();},
    document=globalThis.document,window=globalThis.window,
    now=()=>globalThis.performance?.now?.()??Date.now(),
    // Keep native Window timer methods bound to their host, not this adapter.
    setInterval=(...args)=>globalThis.setInterval(...args),clearInterval=(...args)=>globalThis.clearInterval(...args),
    setTimeout=(...args)=>globalThis.setTimeout(...args),clearTimeout=(...args)=>globalThis.clearTimeout(...args),
  }={}){
    this.profileId=profileId;this.sessionId=sessionId;
    this._onState=onState;this._onMicLevel=onMicLevel;
    this._mediaDevices=mediaDevices;this._createAudioContext=createAudioContext;this._userActivation=userActivation;
    this._document=document;this._window=window;
    this._now=now;
    this._setInterval=setInterval;this._clearInterval=clearInterval;
    this._setTimeout=setTimeout;this._clearTimeout=clearTimeout;
    this._disposed=false;this._micGeneration=0;this._soundGeneration=0;
    this._mic={status:'off',level:0,error:null,errorStage:null,errorCode:null,resumeDiagnostic:null,accessDiagnostic:null,reason:null};
    this._sound={enabled:false,status:'muted',volume:0.35,error:null,errorStage:null,errorCode:null,resumeDiagnostic:null};
    this._pcmNodes=new Set();this._pcmGeneration=-1;this._pcmSequence=0;this._pcmEnd=0;this._pcmFrame=0;this._pcmRate=0;this._pcmDropped=0;this._pcmFrames=0;
    this._tones=new Set();this._cueIds=new Map();this._trackListeners=[];this._resumeWaits=new Map();
    this._onHidden=()=>{if(this._document?.hidden)this.stopAll('hidden');};
    this._onPageHide=()=>this.stopAll('pagehide');
    this._document?.addEventListener?.('visibilitychange',this._onHidden);
    this._window?.addEventListener?.('pagehide',this._onPageHide);
  }
  get state(){
    return {profileId:this.profileId,sessionId:this.sessionId,capabilities:{...mediaCapabilities(this.profileId)},mic:{...this._mic},sound:{...this._sound,pcmFrames:this._pcmFrames,pcmDiscontinuities:this._pcmDropped,pcmQueued:this._pcmNodes.size},disposed:this._disposed};
  }
  _emit(){safely(this._onState,this.state);}
  _level(level){safely(this._onMicLevel,level,{profileId:this.profileId,sessionId:this.sessionId});}
  _resumeContext(context,target,generation){
    return new Promise((resolve,reject)=>{
      let settled=false,timer,initialState='unknown',userActivation=null;
      const current=()=>!this._disposed && this['_'+target+'Generation']===generation && this['_'+target+'Context']===context;
      const record=(outcome,error,finalState)=>{
        const snapshot=Object.freeze({attempt:generation,outcome,initialState,finalState,errorName:resumeErrorName(error),userActivation});
        if(current())this['_'+target].resumeDiagnostic=snapshot;
      };
      const finish=(error,outcome)=>{
        if(settled)return;settled=true;
        if(timer!==undefined)this._clearTimeout(timer);
        this._resumeWaits.delete(context);
        record(outcome,error,contextState(context));
        if(outcome==='resolved' && !error)resolve();else reject(error || new MediaFailure('AUDIO_RESUME_FAILED'));
        // A microphone permission prompt may remain pending after resume settles.
        if(current())this._emit();
      };
      this._resumeWaits.set(context,finish);
      timer=this._setTimeout(()=>finish(new MediaFailure('AUDIO_RESUME_TIMEOUT'),'timed-out'),AUDIO_START_TIMEOUT_MS);
      // No await or state-render callback is inserted between reading activation
      // and invoking resume in the original explicit user's activation turn.
      try{
        initialState=contextState(context);
        const resume=context.resume;
        const active=safely(()=>this._userActivation?.isActive);
        userActivation=typeof active==='boolean'?active:null;
        if(settled || !current()){finish(new MediaFailure('AUDIO_RESUME_FAILED'),'cancelled');return;}
        record('pending',null,initialState);
        Promise.resolve(resume.call(context)).then(
          ()=>finish(contextState(context)==='running'?null:new MediaFailure('AUDIO_RESUME_NOT_RUNNING'),'resolved'),
          error=>finish(error,'rejected'),
        );
      }catch(error){finish(error,'threw');}
    });
  }
  _closeContext(context){
    this._resumeWaits.get(context)?.(new MediaFailure('AUDIO_RESUME_FAILED'),'cancelled');
    closeContext(context);
  }
  _requestMic(requestMedia,generation){
    return new Promise((resolve,reject)=>{
      let settled=false,timer,requestedAt,userActivation=null;
      const current=()=>!this._disposed && this._micGeneration===generation;
      const record=(outcome,error)=>{
        if(current())this._mic.accessDiagnostic=Object.freeze({attempt:generation,outcome,errorName:accessErrorName(error),userActivation});
      };
      const finish=(outcome,error,stream)=>{
        if(settled){if(stream)stopStream(stream);return;}
        settled=true;
        if(timer!==undefined)this._clearTimeout(timer);
        if(this._micAccessWait===cancel)this._micAccessWait=undefined;
        if(!current()){
          if(stream)stopStream(stream);
          reject(new MediaFailure('MICROPHONE_REQUEST_FAILED'));return;
        }
        record(outcome,error);
        if(outcome==='resolved')resolve(stream);else reject(error || new MediaFailure('MICROPHONE_REQUEST_FAILED'));
        this._emit();
      };
      const cancel=()=>finish('cancelled',new MediaFailure('MICROPHONE_REQUEST_FAILED'));
      this._micAccessWait=cancel;
      try{
        requestedAt=this._now();
        if(!Number.isFinite(requestedAt))throw new MediaFailure('MICROPHONE_REQUEST_FAILED');
        const active=safely(()=>this._userActivation?.isActive);
        userActivation=typeof active==='boolean'?active:null;
        if(!current()){cancel();return;}
        record('pending',null);
        timer=this._setTimeout(()=>finish('timed-out',new MediaFailure('MICROPHONE_REQUEST_TIMEOUT')),MICROPHONE_REQUEST_TIMEOUT_MS);
        if(settled || !current()){cancel();return;}
        // Preserve the explicit action's turn, with no render callback before
        // acquisition. This deadline cancels our wait, not the browser prompt.
        const request=requestMedia.call(this._mediaDevices,{audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
        Promise.resolve(request).then(stream=>{
          if(settled || !current()){stopStream(stream);return;}
          // Permission prompts/background throttling can delay the timer itself.
          const now=safely(()=>this._now());
          if(!Number.isFinite(now) || now<requestedAt || now-requestedAt>=MICROPHONE_REQUEST_TIMEOUT_MS){
            stopStream(stream);finish('timed-out',new MediaFailure('MICROPHONE_REQUEST_TIMEOUT'));return;
          }
          finish('resolved',null,stream);
        },error=>finish('rejected',error)).catch(error=>finish('rejected',error));
        if(current() && !settled)this._emit();
      }catch(error){finish('threw',error);}
    });
  }
  _failMic(generation,code,status='error'){
    if(generation!==this._micGeneration || this._disposed)return;
    const resumeDiagnostic=this._mic.resumeDiagnostic;
    this.stopMic('start-error');
    // Cleanup emits state. A callback may have started or cancelled a new action.
    if(this._micGeneration!==generation+1 || this._disposed)return;
    Object.assign(this._mic,{status,...diagnostic(code),resumeDiagnostic});this._emit();
  }
  _failSound(generation,code){
    if(generation!==this._soundGeneration || this._disposed)return;
    const resumeDiagnostic=this._sound.resumeDiagnostic;
    this.muteSound();
    if(this._soundGeneration!==generation+1 || this._disposed)return;
    Object.assign(this._sound,{status:'error',...diagnostic(code),resumeDiagnostic});this._emit();
  }
  setProfile(profileId){
    if(this._disposed || profileId===this.profileId)return;
    this.stopAll('profile-change');this.profileId=profileId;this.sessionId=null;
    this._cueIds.clear();this._pcmGeneration=-1;this._pcmSequence=0;this._pcmFrames=0;this._pcmDropped=0;this._emit();
  }
  setSession(sessionId){
    if(this._disposed || sessionId===this.sessionId)return;
    this.stopAll('session-change');this.sessionId=sessionId;
    this._cueIds.clear();this._pcmGeneration=-1;this._pcmSequence=0;this._pcmFrames=0;this._pcmDropped=0;this._emit();
  }
  async enableMic(){
    if(this._disposed || !mediaCapabilities(this.profileId).microphone || this._document?.hidden)return false;
    if(this._mic.status==='active')return true;
    if(this._mic.status==='requesting')return false;
    const generation=++this._micGeneration;
    this._mic={status:'requesting',level:0,error:null,errorStage:null,errorCode:null,resumeDiagnostic:null,accessDiagnostic:null,reason:null};this._emit();
    if(generation!==this._micGeneration || this._disposed)return false;
    let stream,stage='microphone-access',ownsStream=false;
    try{
      const requestMedia=this._mediaDevices?.getUserMedia;
      if(generation!==this._micGeneration || this._disposed)return false;
      if(typeof requestMedia!=='function'){this._failMic(generation,'MICROPHONE_UNAVAILABLE','unavailable');return false;}
      stage='audio-context';
      const context=this._createAudioContext();
      if(generation!==this._micGeneration || this._disposed){closeContext(context);return false;}
      this._micContext=context;
      // Do not postpone resume until after the browser's permission dialog.
      const resumed=this._resumeContext(context,'mic',generation).then(()=>null,error=>{
        this._failMic(generation,resumeCode(error));
        return error;
      });
      if(generation!==this._micGeneration || this._disposed)return false;
      stage='microphone-access';
      stream=await this._requestMic(requestMedia,generation);
      if(generation!==this._micGeneration || this._disposed){stopStream(stream);return false;}
      this._micStream=stream;ownsStream=true;
      const tracks=stream.getAudioTracks();
      if(!tracks.length || tracks.some(track=>track.readyState==='ended'))throw new MediaFailure('MICROPHONE_NO_LIVE_TRACK');
      for(const track of tracks){
        const onEnded=()=>{if(generation===this._micGeneration)this.stopMic('track-ended');};
        track.addEventListener?.('ended',onEnded);this._trackListeners.push([track,onEnded]);
      }
      const resumeError=await resumed;
      if(generation!==this._micGeneration || this._disposed)return false;
      if(resumeError)throw resumeError;
      stage='microphone-input';
      const analyser=context.createAnalyser();analyser.fftSize=1024;
      const source=context.createMediaStreamSource(stream);
      this._micSource=source;this._micAnalyser=analyser;
      source.connect(analyser); // Deliberately never connected to destination.
      const samples=new Float32Array(analyser.fftSize);
      this._mic={status:'active',level:0,error:null,errorStage:null,errorCode:null,resumeDiagnostic:this._mic.resumeDiagnostic,accessDiagnostic:this._mic.accessDiagnostic,reason:null};this._emit();
      if(generation!==this._micGeneration || this._disposed)return false;
      this._micTimer=this._setInterval(()=>{
        if(generation!==this._micGeneration || this._disposed)return;
        try{
          if(context.state!=='running')throw new MediaFailure('MICROPHONE_INPUT_INTERRUPTED');
          analyser.getFloatTimeDomainData(samples);
          this._mic.level=normalizedRms(samples);this._level(this._mic.level);this._emit();
        }catch(error){
          this._failMic(generation,error instanceof MediaFailure?error.code:'MICROPHONE_INPUT_FAILED');
        }
      },MIC_INTERVAL_MS);
      return true;
    }catch(error){
      if(generation!==this._micGeneration || this._disposed){if(!ownsStream)stopStream(stream);return false;}
      const code=error instanceof MediaFailure?error.code:stage==='audio-context'?'AUDIO_CONTEXT_CREATE_FAILED':stage==='microphone-input'?'MICROPHONE_INPUT_SETUP_FAILED':micCode(error);
      this._failMic(generation,code);return false;
    }
  }
  stopMic(reason='stopped'){
    const wasLive=this._mic.status==='active' || this._mic.status==='requesting';
    const previousAccess=this._mic.accessDiagnostic;
    const accessDiagnostic=previousAccess?.outcome==='pending'?Object.freeze({...previousAccess,outcome:'cancelled',errorName:null}):previousAccess;
    ++this._micGeneration;
    this._micAccessWait?.();
    if(this._micTimer!==undefined){this._clearInterval(this._micTimer);this._micTimer=undefined;}
    for(const [track,listener] of this._trackListeners)track.removeEventListener?.('ended',listener);
    this._trackListeners=[];
    stopStream(this._micStream);this._micStream=undefined;
    safely(()=>this._micSource?.disconnect());safely(()=>this._micAnalyser?.disconnect());
    this._micSource=undefined;this._micAnalyser=undefined;
    this._closeContext(this._micContext);this._micContext=undefined;
    this._mic={status:'off',level:0,error:null,errorStage:null,errorCode:null,resumeDiagnostic:null,accessDiagnostic,reason};
    if(wasLive)this._level(0);
    this._emit();
  }
  async enableSound(){
    if(this._disposed || mediaCapabilities(this.profileId).audioOutput==='none' || this._document?.hidden)return false;
    if(this._sound.enabled)return true;
    if(this._sound.status==='enabling')return false;
    const generation=++this._soundGeneration;
    this._sound.status='enabling';this._sound.error=null;this._sound.errorStage=null;this._sound.errorCode=null;this._sound.resumeDiagnostic=null;this._emit();
    if(generation!==this._soundGeneration || this._disposed)return false;
    let stage='audio-context';
    try{
      const context=this._createAudioContext();
      if(generation!==this._soundGeneration || this._disposed){closeContext(context);return false;}
      this._soundContext=context;stage='audio-resume';
      await this._resumeContext(context,'sound',generation);
      if(generation!==this._soundGeneration || this._disposed)return false;
      // A short clip may already have delivered its final packet. Monitor the
      // context itself so interruption cannot leave queued output armed.
      this._soundStateListener=()=>{
        if(generation===this._soundGeneration && this._soundContext===context && this._sound.enabled && contextState(context)!=='running')
          this._failSound(generation,'SOUND_INTERRUPTED');
      };
      context.addEventListener?.('statechange',this._soundStateListener);
      this._sound.enabled=true;this._sound.status='ready';
      this._soundStateListener();
      if(generation!==this._soundGeneration || this._disposed)return false;
      this._emit();
      return generation===this._soundGeneration && !this._disposed;
    }catch(error){
      if(generation!==this._soundGeneration || this._disposed)return false;
      this._failSound(generation,stage==='audio-resume'?resumeCode(error):error instanceof MediaFailure?error.code:'AUDIO_CONTEXT_CREATE_FAILED');return false;
    }
  }
  muteSound(){
    this._soundContext?.removeEventListener?.('statechange',this._soundStateListener);
    this._soundStateListener=undefined;
    this._stopPcm();
    ++this._soundGeneration;
    for(const tone of [...this._tones])this._stopTone(tone);
    this._closeContext(this._soundContext);this._soundContext=undefined;
    this._sound.enabled=false;this._sound.status='muted';this._sound.error=null;this._sound.errorStage=null;this._sound.errorCode=null;this._sound.resumeDiagnostic=null;this._emit();
  }
  setVolume(volume){
    if(this._disposed || !Number.isFinite(volume))return false;
    this._sound.volume=Math.max(0,Math.min(1,volume));
    for(const node of this._pcmNodes)node.gain.gain.setValueAtTime(this._sound.volume,this._soundContext.currentTime);
    // Stop an in-flight tone so reducing the volume is immediately effective.
    for(const tone of [...this._tones])this._stopTone(tone);
    this._emit();return true;
  }
  _stopPcm(){
    for(const node of this._pcmNodes){
      node.source.onended=null;safely(()=>node.source.stop());safely(()=>node.source.disconnect());safely(()=>node.gain.disconnect());
    }
    this._pcmNodes.clear();this._pcmEnd=0;this._pcmFrame=0;this._pcmRate=0;
  }
  acceptAppPcm({sessionId,packet}={}){
    const frames=speakerFrames(packet);
    if(this._disposed || sessionId!==this.sessionId || !sessionId || mediaCapabilities(this.profileId).audioOutput!=='speaker' || frames<0)return false;
    if(packet.generation<this._pcmGeneration)return false;
    if(packet.generation!==this._pcmGeneration){this._stopPcm();this._pcmGeneration=packet.generation;this._pcmSequence=0;}
    const fresh=frames>0 && packet.sequence>this._pcmSequence;
    if(fresh)this._pcmSequence=packet.sequence; // Muted snapshots never become a backlog.
    const ctx=this._soundContext;
    // Also fence empty/repeated completion packets if the host delays events.
    if(this._sound.enabled && ctx && ctx.state!=='running'){this._failSound(this._soundGeneration,'SOUND_INTERRUPTED');return false;}
    if(!fresh || !this._sound.enabled || !ctx || this._document?.hidden)return false;
    let node;
    try{
      for(const tone of [...this._tones])this._stopTone(tone);
      const bytes=atob(packet.pcm_s16le), buffer=ctx.createBuffer(1,frames,packet.sample_rate), data=buffer.getChannelData(0);
      for(let i=0;i<frames;i++){let v=bytes.charCodeAt(i*2)|(bytes.charCodeAt(i*2+1)<<8);data[i]=(v>=32768?v-65536:v)/32768;}
      const now=ctx.currentTime;
      const contiguous=this._pcmFrame===packet.first_frame && this._pcmRate===packet.sample_rate && this._pcmEnd>=now;
      if(!contiguous && this._pcmEnd){this._pcmDropped++;this._stopPcm();}
      // Bound both browser allocations and latency if a hostile/fast source floods snapshots.
      if(this._pcmNodes.size>=4 || this._pcmEnd>now+0.6)return false;
      const start=contiguous?this._pcmEnd:now+0.03;
      const source=ctx.createBufferSource(),gain=ctx.createGain();node={source,gain};
      source.buffer=buffer;gain.gain.setValueAtTime(this._sound.volume,now);
      source.connect(gain);gain.connect(ctx.destination);this._pcmNodes.add(node);
      source.onended=()=>{this._pcmNodes.delete(node);safely(()=>source.disconnect());safely(()=>gain.disconnect());};
      source.start(start);this._pcmEnd=start+frames/packet.sample_rate;this._pcmFrame=packet.first_frame+frames;this._pcmRate=packet.sample_rate;
      this._pcmFrames+=frames;return true;
    }catch{
      if(node){safely(()=>node.source.stop());safely(()=>node.source.disconnect());safely(()=>node.gain.disconnect());this._pcmNodes.delete(node);}
      this._stopPcm();Object.assign(this._sound,diagnostic('SOUND_PLAYBACK_FAILED'));this._emit();return false;
    }
  }
  testTone({frequencyHz=880,durationMs=120}={}){
    return this._playTone({frequencyHz,durationMs});
  }
  acceptAppTone({sessionId,channel='app',cueId,frequencyHz,durationMs}={}){
    if(this._disposed || sessionId===null || sessionId===undefined || sessionId!==this.sessionId || !['app','diagnostic'].includes(channel) || !Number.isSafeInteger(cueId) || cueId<0)return false;
    const prior=this._cueIds.get(channel);
    if(prior!==undefined && cueId<=prior)return false;
    this._cueIds.set(channel,cueId);
    if(prior===undefined)return false; // Current state is a baseline, not history to replay.
    return this._playTone({frequencyHz,durationMs});
  }
  _playTone(input){
    const value=normalizeTone(input),context=this._soundContext;
    if(this._disposed || !value || !this._sound.enabled || this._sound.volume===0 || !context || this._document?.hidden || mediaCapabilities(this.profileId).audioOutput==='none')return false;
    if(context.state!=='running'){
      this._failSound(this._soundGeneration,'SOUND_INTERRUPTED');return false;
    }
    this._stopPcm();
    // A single device tone at a time; repeated actions cannot accumulate gain.
    for(const previous of [...this._tones])this._stopTone(previous);
    let tone;
    try{
      const oscillator=context.createOscillator();
      tone={oscillator,gain:undefined,timer:undefined,ended:false};this._tones.add(tone);
      const gain=context.createGain();tone.gain=gain;
      oscillator.type=mediaCapabilities(this.profileId).audioOutput==='buzzer'?'square':'sine';
      oscillator.frequency.setValueAtTime(value.frequencyHz,context.currentTime);
      const start=context.currentTime,end=start+value.durationMs/1000;
      const ramp=Math.min(0.008,value.durationMs/4000),amplitude=MAX_GAIN*this._sound.volume;
      gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(amplitude,start+ramp);
      gain.gain.setValueAtTime(amplitude,end-ramp);gain.gain.linearRampToValueAtTime(0,end);
      oscillator.connect(gain);gain.connect(context.destination);
      oscillator.onended=()=>this._stopTone(tone);
      oscillator.start(start);oscillator.stop(end);
      // A defensive wall-clock release covers suspended/interrupted contexts.
      tone.timer=this._setTimeout(()=>this._stopTone(tone),value.durationMs+100);
      return true;
    }catch{
      if(tone)this._stopTone(tone);
      Object.assign(this._sound,diagnostic('SOUND_PLAYBACK_FAILED'));this._emit();return false;
    }
  }
  _stopTone(tone){
    if(tone.ended)return;
    tone.ended=true;if(tone.timer!==undefined)this._clearTimeout(tone.timer);
    tone.oscillator.onended=null;safely(()=>tone.oscillator.stop());
    safely(()=>tone.oscillator.disconnect());safely(()=>tone.gain?.disconnect());
    this._tones.delete(tone);
  }
  stopAll(reason='stopped'){this.stopMic(reason);this.muteSound();}
  dispose(){
    if(this._disposed)return;
    this._disposed=true;this.stopAll('disposed');
    this._document?.removeEventListener?.('visibilitychange',this._onHidden);
    this._window?.removeEventListener?.('pagehide',this._onPageHide);
  }
}
