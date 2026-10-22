// Runs the actual UI module with a small DOM and SDK bridge fixture.
// Not browser layout, host placement, or native PNG decoding evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,existsSync} from 'node:fs';
import {webcrypto,createHash} from 'node:crypto';
import {WorkbenchController,nativePoint,pressDuration} from '../controller.mjs';
import {deviceLayout} from '../device-layout.mjs';
import {DeviceMotion} from '../device-motion.mjs';
import {DeviceMedia} from '../device-media.mjs';
import {readHostMediaSupport} from '../host-media-support.mjs';
import {INPUT_PREVIEW_CATALOG,createInputPreview,applyPreviewInput,drawInputPreview} from '../input-preview.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=readFileSync(new URL('../main.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
class Target{
  constructor(){this.listeners=new Map();this.parent=null;this.children=[];}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);}
  removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(item=>item!==fn));}
  dispatch(type,extra={}){
    const event={type,target:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},detail:0,button:0,isPrimary:true,pointerId:1,key:'',repeat:false,...extra};
    if(type==='click' && this.disabled)return event;
    for(let node=this;node;node=node.parent)for(const fn of node.listeners.get(type)||[])fn(event);
    return event;
  }
}
class Element extends Target{
  constructor(tag){super();this.tagName=tag.toUpperCase();this.attrs={};this.dataset={};this.style={};this.hidden=false;this.disabled=false;this.value='';this._text='';this.draws=[];this.textDraws=[];}
  set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  setAttribute(name,value){this.attrs[name]=String(value);if(name==='id')this.id=String(value);if(name==='hidden')this.hidden=true;if(name==='disabled')this.disabled=true;if(name==='value')this.value=String(value);if(name.startsWith('data-'))this.dataset[name.slice(5)]=String(value);}
  getAttribute(name){return this.attrs[name]??null;}removeAttribute(name){delete this.attrs[name];}
  replaceChildren(...children){this.children=children;for(const child of children)child.parent=this;if(this.tagName==='SELECT')this.value=children[0]?.value || '';}
  closest(selectors){for(let n=this;n instanceof Element;n=n.parent)for(const selector of selectors.split(','))if(selector==='[contenteditable=true]'?n.attrs.contenteditable==='true':n.tagName===selector.toUpperCase())return n;return null;}
  setPointerCapture(id){this.pointer=id;}hasPointerCapture(id){return this.pointer===id;}releasePointerCapture(id){if(this.pointer===id){this.pointer=null;this.dispatch('lostpointercapture',{pointerId:id});}}
  getBoundingClientRect(){return this.bounds || {left:100,top:40,width:640,height:480};}
  getContext(){return {imageSmoothingEnabled:true,drawImage:(...args)=>this.draws.push(args),fillRect(){},fillText:(...args)=>this.textDraws.push(args)};}
}
function makeDOM(){
  const document=new Target(),window=new Target();document.hidden=false;const ids=new Map(),all=[];const stack=[document];
  const tokens=/<\/?([a-z][\w:-]*)\b([^>]*?)>/gi;let match;
  const voids=new Set(['meta','link','input','br','img','path','rect','circle']);
  while((match=tokens.exec(html.slice(0,html.indexOf('<script'))))){
    const tag=match[1].toLowerCase();if(match[0].startsWith('</')){if(stack.at(-1).tagName===tag.toUpperCase())stack.pop();continue;}
    const node=new Element(tag),parent=stack.at(-1);node.parent=parent;parent.children.push(node);all.push(node);
    const attrs=/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;let attr;
    while((attr=attrs.exec(match[2])))node.setAttribute(attr[1],attr[2]??attr[3]??attr[4]??'');
    if(node.id)ids.set(node.id,node);if(tag==='body')document.body=node;if(!voids.has(tag))stack.push(node);
  }
  document.getElementById=id=>ids.get(id);document.createElement=tag=>new Element(tag);
  document.querySelectorAll=selector=>selector==='[data-roll]'?all.filter(n=>Object.hasOwn(n.dataset,'roll')):[];
  return {document,window,ids,all};
}
const profiles=[{id:'atoms3r',label:'AtomS3R C126',width:128,height:128,primaryInput:'button',motion:true,microphone:false,audioOutput:'none'},{id:'stickcplus2',label:'StickC Plus2',width:135,height:240,primaryInput:'button',motion:true,microphone:true,audioOutput:'buzzer'},{id:'cores3',label:'CoreS3',width:320,height:240,primaryInput:'touch',motion:true,microphone:true,audioOutput:'speaker'}];
profiles.push({id:'sticks3',label:'StickS3 K150',width:135,height:240,primaryInput:'button',motion:true,microphone:true,audioOutput:'speaker'});
profiles.push({id:'cores3se',label:'CoreS3 SE',width:320,height:240,primaryInput:'touch',touchStrip:true,touchWidth:320,touchHeight:280,spatialTouch:true,motion:false,microphone:true,audioOutput:'speaker'});
for(const profile of profiles)profile.powerButton=['cores3','cores3se'].includes(profile.id);
const catalog={profiles,apps:[{id:'counter',label:'Input test'},{id:'custom',label:'My device app'}]};
const voiceDestination={id:'sample-service-voice',generation:'fixture-v1',application:'Sample app',provider:'Fixture provider',model:'fixture-transcribe',
  endpointDisplay:'https://voice.example.test/transcribe',operation:'transcribe',storage:'private-durable-draft',maxOriginalBytes:2097152,maxDurationMs:30000};
const voiceDescriptorSha256='0'.repeat(64);
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
async function fixture(options={}){
  const dom=makeDOM(),calls=[],modes=[],contextCalls=[],contextWaiters=[],timers=new Map(),deadlines=new Map(),drawWaiters=[],observers=[],mediaInstances=[],mediaRequests=[],mediaContexts=[],micIntervals=new Map(),permissionWaiters=[],controllers=[],recorders=[],voiceInstances=[],voiceWaiters=[],frameWaiters=[],micWaiters=[],toolOptions=[],captureWaiters=[],liveMicInstances=[];
  const pcmContexts=[],pcmNodes=[],pcmTrace=[],pcmModules=[],pcmRevoked=[],pcmModuleWaiters=[];
  let next=0,now=1000,session=1,bridge,holdDecode=false,holdFrames=false,holdMic=false,empty=options.empty,bridgeConnected=false,captureSequence=options.nativeState?.capture_intent?.sequence || 0;
  const track=new Target();track.kind='audio';track.readyState='live';track.stops=0;track.stop=()=>{track.stops++;track.readyState='ended';};
  const stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
  const fakeNode=()=>({connect(){},disconnect(){this.disconnected=true;}});
  function createAudioContext(){
    if(options.rejectAudioCreate)throw new Error('Untrusted host context detail');
    const context={state:'suspended',currentTime:0,destination:{},tones:[],resume:async()=>{options.onAudioResume?.();if(options.rejectAudioResume)throw Object.assign(new Error('Untrusted host resume detail'),{name:options.audioResumeErrorName??'NotAllowedError'});if(Object.hasOwn(options,'audioResumeRejection'))throw options.audioResumeRejection;context.state='running';},close:async()=>{context.state='closed';},
      createAnalyser:()=>({...fakeNode(),fftSize:1024,getFloatTimeDomainData:array=>array.fill(options.micSample??.5)}),
      createMediaStreamSource:()=>fakeNode(),
      createGain:()=>({...fakeNode(),gain:{setValueAtTime(){},linearRampToValueAtTime(){}}}),
      createOscillator:()=>{const oscillator={...fakeNode(),frequency:{setValueAtTime(){}},start(){context.tones.push(this);},stop(){}};return oscillator;}};
    mediaContexts.push(context);return context;
  }
  let state={sessionId:'session-1',profile:options.profile || 'atoms3r',app:'counter',status:'running',revision:1,buildId:'fixture-build',catalog,...(options.nativeState?{nativeState:structuredClone(options.nativeState)}:{})};
  const response=()=>{
    if(empty)return {structuredContent:{status:'welcome',mode:'input-preview',sessionId:null,profile:state.profile,app:state.app,catalog}};
    const profile=profiles.find(p=>p.id===state.profile);Object.assign(state,{width:profile.width,height:profile.height,capabilities:{primaryInput:profile.primaryInput,powerButton:Boolean(options.powerAdapter&&profile.powerButton&&['counter','custom'].includes(state.app)),motion:profile.motion,microphone:options.mediaAdapter?profile.microphone:false,audioOutput:options.mediaAdapter?profile.audioOutput:'none',appAdapter:options.appAdapter?1:0,recordingInput:Boolean(options.appAdapter&&profile.microphone),imageInput:Boolean(options.appAdapter),spatialTouch:Boolean(options.appAdapter&&profile.primaryInput==='touch'),captureAdapter:options.captureHandshake?1:0,captureHandshake:Boolean(options.captureHandshake)}});
    Object.assign(state.capabilities,{audioInputAdapter:options.audioInputAdapter&&profile.microphone?1:0,microphonePcm:Boolean(options.audioInputAdapter&&profile.microphone),touchStrip:Boolean(options.touchStrip&&options.appAdapter&&profile.id==='cores3se')});
    if(options.audioInputAdapter)state.nativeState={audio_input:{requested:profile.microphone},...state.nativeState};
    const bytes=Buffer.from(JSON.stringify({width:profile.width,height:profile.height}));
    return {structuredContent:structuredClone(state),...(state.status==='running'?{_meta:{frame:{mimeType:'image/png',data:bytes.toString('base64'),sha256:options.badHash?'0'.repeat(64):createHash('sha256').update(bytes).digest('hex'),width:profile.width,height:profile.height}}}:{})};
  };
  const applyVoice=waiter=>{
    if(waiter.result)return waiter.result;
    const status=options.voiceReceiptStatus || 'delivered',complete=['delivered','committed'].includes(status);
    state={...state,revision:state.revision+1,nativeState:{...state.nativeState,expected_result:options.nextVoiceContext?{draft_id:'draft-1',request_id:'image-2',revision:2}:null,
      ...(options.clearRecordingOnVoice?{recording:null,recording_capture:null}:{})}};
    if(options.voiceNativeUnavailable){state.status='unavailable';state.nativeState=null;}
    const result=response(),c=waiter.request.arguments.consent;
    const transcript=options.voiceTranscript || 'A quiet garden beside the sea.';
    waiter.result={...result,_meta:{...result._meta,voice:{status,offerId:waiter.request.arguments.offerId,destinationId:c.destinationId,clipId:c.clipId,context:c.context,
      operationId:c.operationId,descriptorSha256:c.descriptorSha256,delivery:options.voiceDelivery || (status==='delivered'?'native':status==='committed'?'full-review':'pending'),
      ...(status==='delivered'?{nativeDelivery:'accepted'}:{}),...(options.nativeDelivery!==undefined?{nativeDelivery:options.nativeDelivery}:{}),
      ...(complete?{durable:{draftId:'00000000-0000-4000-8000-000000000002',revision:2,transcriptId:'00000000-0000-4000-8000-000000000003',sha256:createHash('sha256').update(transcript).digest('hex'),utf8Bytes:Buffer.byteLength(transcript)},transcript}:{})}}};
    return waiter.result;
  };
  class App{
    constructor(info,capabilities){bridge=this;this.info=info;this.capabilities=capabilities;}
    async connect(){assert.equal(typeof this.ontoolresult,'function');if(options.rejectConnect)throw new Error('Owned host connection failure.');if(!options.lateOpener)this.ontoolresult(response());bridgeConnected=true;}
    getHostCapabilities(){if(options.rejectHostCapabilities)throw new Error('Untrusted capability failure');return options.hostCapabilities;}
    getHostContext(){return {displayMode:'inline',availableDisplayModes:options.fullscreen===false?['inline']:['inline','fullscreen']};}
    async requestDisplayMode(value){modes.push(value);return {mode:'fullscreen'};}
    async callServerTool(request,config){
      pcmTrace.push(request.name+':'+(request.arguments.event?.type || ''));
      calls.push(request);toolOptions.push({request,config});const args=request.arguments;
      if(request.name==='m5stack_voice_cancel')return {structuredContent:{status:'cancelled',offerId:args.offerId}};
      assert.equal(args.sessionId,state.sessionId);
      if(request.name==='m5stack_voice_prepare'){
        const r=state.nativeState.recording;
        return {structuredContent:{offerId:'00000000-0000-4000-8000-000000000001',sessionId:state.sessionId,clip:{id:r.id,mimeType:r.mime_type,durationMs:r.duration_ms,bytes:r.bytes,sha256:r.sha256,source:r.source},context:args.context,
          destination:{...voiceDestination},descriptorSha256:voiceDescriptorSha256,operationId:'00000000-0000-4000-8000-000000000004',expiresInMs:90000,hostReceivesAudio:true,automaticRetries:false}};
      }
      if(request.name==='m5stack_voice_submit')return new Promise(resolve=>voiceWaiters.push({resolve,request,config,result:null}));
      if(request.name==='m5stack_frame'&&holdFrames)await new Promise(resolve=>frameWaiters.push(resolve));
      if(request.name==='m5stack_input'&&args.event.type==='mic'&&holdMic)await new Promise(resolve=>micWaiters.push(resolve));
      if(request.name==='m5stack_stop'){state={...state,status:'stopped'};return {structuredContent:{sessionId:state.sessionId,status:'stopped'}};}
      if(request.name==='m5stack_select'){state.profile=args.profile || state.profile;state.app=args.app || state.app;state.sessionId='session-'+(++session);}
      if(request.name==='m5stack_reload')state={...state,sessionId:'session-'+(++session),status:'running',nativeState:{recording:null,recording_capture:null,capture_intent:null,expected_result:null,mic_level:0,roll_degrees:0}};
      if(request.name==='m5stack_input' && args.event.type==='mic')state.nativeState={...state.nativeState,mic_level:args.event.level*100,mic_source:args.event.source};
      if(request.name==='m5stack_input' && args.event.type==='recording_request'){
        assert.equal(options.captureHandshake,true);
        if(options.rejectCapture)throw new Error('Synthetic native handshake failure');
        captureSequence=Math.max(captureSequence,state.nativeState?.capture_intent?.sequence || 0)+1;
        state.nativeState={...state.nativeState,recording_capture:null,recording:null,capture_intent:options.declineCapture?null:{id:options.captureId || args.event.id,source:args.event.source,action:'start',sequence:captureSequence,...options.captureReply}};
        state.revision++;const reply=response();
        if(options.holdCaptureRequest)return new Promise(resolve=>captureWaiters.push({resolve,reply}));
        return reply;
      }
      if(request.name==='m5stack_input' && args.event.type==='recording_start'){
        if(options.captureHandshake){assert.equal(args.event.id,state.nativeState.capture_intent?.id);assert.equal(args.event.source,state.nativeState.capture_intent?.source);}
        state.nativeState={...state.nativeState,recording_capture:{id:args.event.id,source:args.event.source,...(options.captureHandshake?{stopped:false}:{})},recording:null,...(options.captureHandshake?{capture_intent:null}:{})};
      }
      if(request.name==='m5stack_input' && args.event.type==='recording_stopped'){
        assert.equal(options.captureHandshake,true);assert.equal(args.event.id,state.nativeState.recording_capture?.id);assert.equal(args.event.source,state.nativeState.recording_capture?.source);
        if(args.event.source==='browser')assert.ok(track.stops>0,'microphone tracks are released before Stopped');
        state.nativeState={...state.nativeState,capture_intent:null,recording_capture:{...state.nativeState.recording_capture,stopped:true}};
      }
      if(request.name==='m5stack_input' && args.event.type==='recording' && options.captureHandshake)assert.equal(state.nativeState.recording_capture?.stopped,true,'Stopped precedes Ready');
      if(request.name==='m5stack_input' && args.event.type==='recording')state.nativeState={...state.nativeState,recording_capture:null,recording:args.event.recording,
        ...(options.voiceAdapter?{expected_result:{draft_id:'draft-1',request_id:'transcribe-1',revision:1}}:{})};
      if(request.name==='m5stack_input' && ['recording_clear','reset'].includes(args.event.type)){
        if(args.event.type==='recording_clear' && args.event.id){const current=state.nativeState?.capture_intent || state.nativeState?.recording_capture || state.nativeState?.recording;assert.equal(current?.id,args.event.id);assert.equal(current?.source,args.event.source);}
        state.nativeState={...state.nativeState,recording_capture:null,recording:null,...(options.captureHandshake?{capture_intent:null}:{})};
      }
      state.revision++;return response();
    }
  }
  class OpenAIExtensions{
    constructor(){this.modelContext=options.modelContext?{update:async value=>{assert.equal(bridgeConnected,true,'context must wait for SDK connection');contextCalls.push(value);if(options.rejectContext)throw new Error('Context unavailable');if(options.holdContext)await new Promise(resolve=>contextWaiters.push(resolve));return options.unacknowledged?undefined:{updateId:'context-'+contextCalls.length};}}:undefined;}
  }
  class FakePCMContext{
    constructor(config){
      pcmTrace.push('construct');this.config=config;this.sampleRate=options.pcmSampleRate ?? 16000;this.state='suspended';this.closed=0;this.sources=[];
      this.audioWorklet={addModule:url=>{
        pcmTrace.push('module');this.moduleUrl=url;
        if(options.rejectPCMModule)return Promise.reject(new Error('Untrusted module failure detail'));
        if(options.holdPCMModule)return new Promise(resolve=>pcmModuleWaiters.push(resolve));
        return Promise.resolve();
      }};pcmContexts.push(this);
    }
    resume(){pcmTrace.push('resume');this.state='running';return Promise.resolve();}
    close(){pcmTrace.push('close');this.state='closed';this.closed++;return Promise.resolve();}
    createMediaStreamSource(value){assert.equal(value,stream);if(options.rejectPCMSource)throw new DOMException('Private device details','NotSupportedError');const node={connect:target=>{node.target=target;},disconnect(){this.disconnected=true;}};this.sources.push(node);return node;}
  }
  class FakePCMNode{
    constructor(context,name,config){
      assert.equal(name,PCM_PROCESSOR_NAME);assert.equal(config.numberOfOutputs,0);assert.equal(config.channelCount,1);
      this.context=context;this.config=config;this.canceled=false;this.started=false;
      this.port={onmessage:null,postMessage:message=>{
        pcmTrace.push('port:'+message.type);
        if(message.type==='begin'){this.startedAt=now;if(!options.holdPCMStart)queueMicrotask(()=>this.start());}
        if(message.type==='stop'){
          const frames=Math.min(480000,Math.max(128,Math.floor((now-this.startedAt)*16)));
          const samples=new Int16Array(frames);for(let i=0;i<frames;i++)samples[i]=(i%64-32)*128;
          queueMicrotask(()=>this.port.onmessage?.({data:{type:'complete',samples:samples.buffer,frames,sampleRate:16000}}));
        }
        if(message.type==='cancel')this.canceled=true;
      },close:()=>{this.port.closed=true;}};pcmNodes.push(this);
    }
    start(){if(this.canceled || this.started)return;this.started=true;this.port.onmessage?.({data:{type:'started',sampleRate:16000}});this.port.onmessage?.({data:{type:'progress',frames:128,durationMs:8,sampleRate:16000}});}
    disconnect(){this.disconnected=true;}
  }
  dom.window.navigator={mediaDevices:{getUserMedia(){throw new Error('Passive diagnostics must not request capture');}}};
  dom.window.AudioContext=function(){throw new Error('Passive diagnostics must not create contexts');};
  dom.window.AudioWorkletNode=function(){};dom.window.isSecureContext=true;
  if(typeof options.microphonePolicy==='boolean')dom.document.permissionsPolicy={allowsFeature:name=>{assert.equal(name,'microphone');return options.microphonePolicy;}};
  class FakeLiveMicrophone{
    constructor(args){this.args=args;this.state={status:'off',armed:false,requested:false,level:0,receivedFrames:0,error:'',errorCode:null};this.diagnostics=[];this.enables=[];this.disables=[];this.requests=[];liveMicInstances.push(this);}
    enable(args){this.enables.push(args);this.state={...this.state,armed:true,requested:args.requested,status:args.requested?'active':'armed'};this.args.onState();return Promise.resolve(true);}
    setRequest(requested,revision){this.requests.push({requested,revision});if(!this.state.armed||this.state.requested===requested)return;this.state={...this.state,requested,status:requested?'active':'armed'};this.args.onState();}
    disable(reason){this.disables.push(reason);this.state={...this.state,armed:false,status:'off',level:0};this.args.onState();}
    dispose(){this.disable('dispose');}
  }
  const context=vm.createContext({...dom,LiveMicrophone:FakeLiveMicrophone,readHostMediaSupport,ResizeObserver:class{constructor(callback){this.callback=callback;observers.push(this);}observe(node){this.node=node;}disconnect(){this.disconnected=true;}},localStorage:{getItem(){throw new Error('Panel must not read stored onboarding');},setItem(){throw new Error('Panel must not write stored onboarding');}},App,OpenAIExtensions,applyDocumentTheme(){},applyHostStyleVariables(){},Element,WorkbenchController:class extends WorkbenchController{
    constructor(args){super({...args,schedule:fn=>{timers.set(++next,fn);return next;},cancel:key=>timers.delete(key)});controllers.push(this);}
  },DeviceMotion:class extends DeviceMotion{constructor(shell,args){super(shell,{...args,getStyle:element=>({width:String(element.getBoundingClientRect().width),height:String(element.getBoundingClientRect().height),transform:element.style.transform}),mediaQuery:null});}},
  DeviceMedia:class extends DeviceMedia{constructor(args){super({...args,createAudioContext,userActivation:options.userActivation,
    setInterval:fn=>{micIntervals.set(++next,fn);return next;},clearInterval:key=>micIntervals.delete(key),
    setTimeout:(fn,ms)=>{deadlines.set(++next,{fn,ms});return next;},clearTimeout:key=>deadlines.delete(key),
    mediaDevices:{getUserMedia:async request=>{mediaRequests.push(request);if(options.holdPermission)return new Promise(resolve=>permissionWaiters.push(resolve));if(options.allowMic)return stream;throw Object.assign(new Error('Untrusted fixture refusal'),{name:options.micErrorName??'NotAllowedError'});}}});mediaInstances.push(this);}},
  nativePoint,pressDuration,deviceLayout,INPUT_PREVIEW_CATALOG,createInputPreview,applyPreviewInput,drawInputPreview,crypto:webcrypto,atob,Blob,performance:{now:()=>now},console,
    setTimeout:(fn,ms)=>{deadlines.set(++next,{fn,ms});return next;},clearTimeout:key=>deadlines.delete(key),
    createImageBitmap:async blob=>{if(holdDecode)await new Promise(resolve=>drawWaiters.push(resolve));const size=JSON.parse(await blob.text());return {...size,close(){}};},
  });
  await vm.runInContext('(async()=>{'+source+'})()',context,{timeout:1000});await settle();
  const primary=()=>dom.ids.get(['stickcplus2','sticks3'].includes(dom.ids.get('device-shell').dataset.profile)?'device-primary':'bezel');
  return {...dom,liveMicInstances,calls,modes,contextCalls,timers,bridge,primary,observers,mediaInstances,mediaRequests,mediaContexts,track,micIntervals,controllers,recorders,voiceInstances,voiceWaiters,toolOptions,pcmContexts,pcmNodes,pcmTrace,pcmModules,pcmRevoked,
    async releaseCaptureRequest(count=captureWaiters.length){captureWaiters.splice(0,count).forEach(waiter=>waiter.resolve(waiter.reply));await settle();},
    async releasePCMModule(){pcmModuleWaiters.splice(0).forEach(resolve=>resolve());await settle();},
    async startPCM(){for(const node of pcmNodes)node.start();await settle();},
    async poll(){for(const [id,fn]of [...timers]){timers.delete(id);fn();}await settle();},
    holdMic(){holdMic=true;},async releaseMic(){holdMic=false;micWaiters.splice(0).forEach(resolve=>resolve());await settle();},
    holdPoll(){holdFrames=true;},async releasePoll(){holdFrames=false;frameWaiters.splice(0).forEach(resolve=>resolve());await settle();},
    applyVoice(){for(const waiter of voiceWaiters)applyVoice(waiter);},
    async releaseVoice(result){for(const waiter of voiceWaiters.splice(0))waiter.resolve(result??applyVoice(waiter));await settle();},
    async sampleMic(){for(const fn of micIntervals.values())fn();await settle();},
    async grantMic(){permissionWaiters.splice(0).forEach(resolve=>resolve(stream));await settle();},
    async expireMicPermission(){const [id,entry]=[...deadlines].find(([,value])=>value.ms===30000);deadlines.delete(id);entry.fn();await settle();},
    async badFrame(){options.badHash=true;state.revision++;bridge.ontoolresult(response());await settle();},
    resize(width,height){dom.ids.get('stage').bounds={left:0,top:0,width,height};for(const observer of observers)if(!observer.disconnected)observer.callback();},
    expireFeedback(){for(const [id,entry] of deadlines)if(entry.ms===320){deadlines.delete(id);entry.fn();}},
    advance(ms){now+=ms;},
    async choose(id,value){dom.ids.get(id).value=value;dom.ids.get(id).dispatch('change');await settle();},
    async click(id){(id==='primary'?primary():dom.ids.get(id)).dispatch('click');await settle();},
    down(id='primary',extra={}){(id==='primary'?primary():dom.ids.get(id)).dispatch('pointerdown',{clientX:420,clientY:280,...extra});},
    async up(id='primary',extra={}){(id==='primary'?primary():dom.ids.get(id)).dispatch('pointerup',extra);await settle();},
    keyDown(key,extra={}){return dom.document.body.dispatch('keydown',{key,...extra});},
    async keyUp(key){dom.document.body.dispatch('keyup',{key});await settle();},
    hold(){holdDecode=true;},async release(){holdDecode=false;drawWaiters.splice(0).forEach(resolve=>resolve());await settle();},
    async expireDecode(){const [id,entry]=[...deadlines].find(([,value])=>value.ms===5000);deadlines.delete(id);entry.fn();await settle();},
    async releaseContext(){contextWaiters.splice(0).forEach(resolve=>resolve());await settle();},
    async update(patch){state={...state,...patch};bridge.ontoolresult(response());await settle();},
    async native(patch={}){empty=false;state={...state,...patch};bridge.ontoolresult(response());await settle();},
    async welcome(patch={}){empty=true;state={...state,...patch};bridge.ontoolresult(response());await settle();},
    async error(){bridge.ontoolresult({isError:true,content:[{type:'text',text:'Owned fixture error.'}]});await settle();},
  };
}
test('SE lower strip delivers separate A/B/C region centers with a 240-high framebuffer',async()=>{
  const f=await fixture({profile:'cores3se',appAdapter:true,touchStrip:true});
  assert.equal(f.ids.get('device-touch-strip').hidden,false);
  for(const [id,x] of [['device-touch-a',53],['device-touch-b',160],['device-touch-c',266]]){
    assert.equal(f.ids.get(id).disabled,false);await f.click(id);
    assert.deepEqual({...f.calls.at(-1).arguments.event},{type:'primary',durationMs:50,x,y:260});
  }
  assert.equal(f.ids.get('frame').width,320);assert.equal(f.ids.get('frame').height,240);
});
test('SE strip pointer mapping, swipe, keyboard and cancellation stay within its touch surface',async()=>{
  const f=await fixture({profile:'cores3se',appAdapter:true,touchStrip:true});
  f.ids.get('device-touch-strip').bounds={left:100,top:500,width:640,height:80};
  f.down('device-touch-a',{clientX:200,clientY:540});f.advance(80);
  await f.up('device-touch-a',{clientX:600,clientY:540});
  assert.deepEqual({...f.calls.at(-1).arguments.event},{type:'swipe',x:50,y:260,endX:250,endY:260,durationMs:80});
  f.advance(800);f.keyDown('Enter',{target:f.ids.get('device-touch-b')});f.advance(65);await f.keyUp('Enter');
  assert.deepEqual({...f.calls.at(-1).arguments.event},{type:'primary',x:160,y:260,durationMs:65});
  const count=f.calls.length;
  f.down('device-touch-a',{clientX:200,clientY:540});await f.up('device-touch-a',{clientX:200,clientY:581});
  assert.equal(f.calls.length,count,'release outside surface is cancelled');
  f.down('device-touch-a',{clientX:200,clientY:540});f.ids.get('device-touch-a').dispatch('pointercancel');await f.up('device-touch-a');
  assert.equal(f.calls.length,count);
});
test('SE strip is gated for old workers and hidden on other profiles',async()=>{
  const old=await fixture({profile:'cores3se',appAdapter:true});
  assert.equal(old.ids.get('device-touch-strip').hidden,false);assert.equal(old.ids.get('device-touch-a').disabled,true);
  await old.click('device-touch-a');assert.equal(old.calls.length,0);
  const other=await fixture({profile:'cores3',appAdapter:true,touchStrip:true});
  assert.equal(other.ids.get('device-touch-strip').hidden,true);await other.click('device-touch-a');assert.equal(other.calls.length,0);
  const preview=await fixture({profile:'cores3se',empty:true});
  await preview.click('device-touch-b');assert.equal(preview.calls.length,0);assert.equal(preview.ids.get('preview-value').textContent,'Count 1');
});
test('actual UI takes launch result and asks fullscreen once only when host advertises it',async()=>{
  const f=await fixture();assert.equal(f.calls.length,0);assert.equal(f.modes.length,1);assert.deepEqual([...f.bridge.capabilities.availableDisplayModes],['fullscreen']);
  assert.equal(f.ids.get('frame').width,128);assert.equal(f.ids.get('frame').height,128);assert.equal(f.ids.get('status').textContent,'Running');
  const no=await fixture({fullscreen:false});assert.equal(no.modes.length,0);
});
test('empty launch immediately shows illustrative Hello World and functional inputs without worker calls',async()=>{
  const f=await fixture({empty:true});assert.equal(f.ids.get('empty').hidden,true);assert.equal(f.ids.get('display').hidden,false);assert.equal(f.ids.get('frame').draws.length,0);
  assert.ok(f.ids.get('frame').textDraws.some(args=>args[0]==='Hello, world!'));assert.equal(f.ids.get('display-mode').textContent,'Input preview');assert.equal(f.ids.get('preview-value').textContent,'Count 0');assert.equal((f.primary().disabled || f.primary().getAttribute('aria-disabled')==='true'),false);
  await f.choose('profile','cores3');assert.equal(f.calls.length,0);assert.equal(f.ids.get('profile').disabled,false);assert.equal(f.ids.get('app').tagName,'OUTPUT');
});
test('measured pointer hold survives polling suspension and produces one primary action',async()=>{
  const f=await fixture();f.down();assert.equal(f.timers.size,0);f.advance(1200);await f.up();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'m5stack_input');assert.equal(f.calls[0].arguments.event.type,'primary');assert.equal(f.calls[0].arguments.event.durationMs,1200);
  f.primary().dispatch('click',{detail:1});await settle();assert.equal(f.calls.length,1);assert.ok(f.calls[0].arguments.requestId);
});
test('keyboard hold ignores repeats, prevents default repeated Space, and has one release',async()=>{
  const f=await fixture();f.keyDown(' ');const repeated=f.keyDown(' ',{repeat:true});assert.equal(repeated.defaultPrevented,true);f.advance(1000);await f.keyUp(' ');
  await f.click('primary');assert.equal(f.calls.length,1);assert.equal(f.calls[0].arguments.event.durationMs,1000);
});
test('cancelled pointer and lost focus produce no delayed action',async()=>{
  const f=await fixture();f.down();f.primary().dispatch('pointercancel');f.advance(80);await f.up();assert.equal(f.calls.length,0);
  f.keyDown('a');f.window.dispatch('blur');await f.keyUp('a');assert.equal(f.calls.length,0);
});
test('Core pointer maps native touch coordinates while Stick display has no touch role',async()=>{
  const f=await fixture({profile:'cores3'});assert.equal(f.ids.get('bezel').getAttribute('role'),'button');f.down('bezel',{clientX:420,clientY:280});f.advance(60);await f.up('bezel');
  const event=f.calls[0].arguments.event;assert.equal(event.x,160);assert.equal(event.y,120);assert.equal(event.durationMs,60);
  await f.choose('profile','stickcplus2');assert.equal(f.ids.get('bezel').getAttribute('role'),null);assert.equal(f.ids.get('frame').width,135);assert.equal(f.ids.get('frame').height,240);
});
test('session change cancels unfinished gesture and previous decode cannot overwrite new device',async()=>{
  const f=await fixture();f.down();await f.update({sessionId:'changed',profile:'cores3',revision:2});await f.up();assert.equal(f.calls.length,0);assert.equal(f.ids.get('frame').width,320);
  f.hold();await f.update({sessionId:'next',profile:'stickcplus2',revision:3});await f.update({sessionId:'latest',profile:'atoms3r',revision:4});await f.release();
  assert.equal(f.ids.get('frame').width,128);assert.equal(f.ids.get('revision').textContent,'4');
});
test('Stop preserves last pixels, disables input, and pagehide cancels polling',async()=>{
  const f=await fixture();const frames=f.ids.get('frame').draws.length;await f.click('stop');assert.equal((f.primary().disabled || f.primary().getAttribute('aria-disabled')==='true'),true);assert.equal(f.ids.get('status').textContent,'Stopped');assert.equal(f.ids.get('message').hidden,true);
  assert.equal(f.ids.get('frame').draws.length,frames);assert.equal(f.timers.size,0);f.window.dispatch('pagehide');assert.equal(f.timers.size,0);
});
test('corrupt display hash never draws or enables input and stops polling',async()=>{
  const f=await fixture({badHash:true});assert.equal(f.ids.get('frame').draws.length,0);assert.equal((f.primary().disabled || f.primary().getAttribute('aria-disabled')==='true'),true);assert.equal(f.timers.size,0);assert.match(f.ids.get('message').textContent,/verification failed/);
});
test('decode deadline retains old pixels, stops polling, and discards late image',async()=>{
  const f=await fixture();const frames=f.ids.get('frame').draws.length;f.hold();await f.update({revision:2});await f.expireDecode();
  assert.equal(f.ids.get('frame').draws.length,frames);assert.equal((f.primary().disabled || f.primary().getAttribute('aria-disabled')==='true'),true);assert.equal(f.timers.size,0);assert.match(f.ids.get('message').textContent,/timed out/);
  await f.release();assert.equal(f.ids.get('frame').draws.length,frames);assert.equal(f.ids.get('revision').textContent,'1');
});
test('initial context is published once, and explicit device changes attach the new selection',async()=>{
  const f=await fixture({empty:true,modelContext:true});assert.equal(f.contextCalls.length,1);assert.equal(f.contextCalls[0].structuredContent.selectedProfile,'atoms3r');
  await f.choose('profile','cores3');assert.equal(f.calls.length,0);assert.equal(f.contextCalls.length,2);
  assert.equal(f.contextCalls[1].structuredContent.selectedProfile,'cores3');assert.equal(f.contextCalls[1].structuredContent.width,320);
  assert.equal(f.contextCalls[1].structuredContent.runningProfile,null);assert.equal(f.contextCalls[1].structuredContent.sessionId,null);assert.equal(f.contextCalls[1].structuredContent.mode,'input-preview');
  assert.equal(f.ids.get('profile').value,'cores3');assert.equal(f.ids.get('dimensions').textContent,'320 × 240');assert.equal(f.ids.has('context-status'),false);assert.equal(f.ids.get('display').hidden,false);
});
test('missing context extension leaves the simulation usable without chat copy',async()=>{
  const f=await fixture({empty:true});await f.choose('profile','stickcplus2');assert.equal(f.contextCalls.length,0);
  assert.equal(f.ids.get('profile').value,'stickcplus2');assert.equal(f.ids.has('context-status'),false);await f.click('primary');assert.equal(f.ids.get('preview-value').textContent,'Count 1');
});
test('context updates serialize latest intent and pagehide discards queued updates',async()=>{
  const f=await fixture({empty:true,modelContext:true,holdContext:true});await f.choose('profile','stickcplus2');await f.choose('profile','cores3');await f.choose('profile','atoms3r');
  assert.equal(f.contextCalls.length,1);await f.releaseContext();assert.equal(f.contextCalls.length,2);assert.equal(f.contextCalls[1].structuredContent.selectedProfile,'atoms3r');
  await f.choose('profile','cores3');f.window.dispatch('pagehide');await f.releaseContext();assert.equal(f.contextCalls.length,2);
});
test('failed or unacknowledged optional context does not interrupt simulation or expose chat status',async()=>{
  for(const option of ['unacknowledged','rejectContext']){const f=await fixture({empty:true,modelContext:true,[option]:true});await f.choose('profile','cores3');assert.equal(f.ids.has('context-status'),false);await f.click('primary');assert.equal(f.ids.get('preview-value').textContent,'Count 1');assert.equal(f.ids.get('message').hidden,true);}
});
test('welcome honors exact initial device and displays the local Hello World app',async()=>{
  const f=await fixture({empty:true,profile:'cores3'});
  assert.equal(f.ids.get('profile').value,'cores3');assert.equal(f.ids.get('device-shell').dataset.profile,'cores3');assert.equal(f.ids.get('frame').width,320);assert.equal(f.ids.get('frame').height,240);
  assert.equal(f.ids.get('device-primary').hidden,true);assert.equal(f.ids.get('bezel').getAttribute('aria-label'),'Tap the device display');assert.equal(f.ids.get('session-actions').hidden,true);
  assert.equal(f.ids.get('session-id').textContent,'—');assert.equal(f.ids.get('build-id').textContent,'—');assert.equal(f.ids.get('revision').textContent,'—');
  assert.match(f.ids.get('display-mode').title,/Illustrative/);assert.equal(f.timers.size,0);
  await f.welcome({app:'custom'});assert.equal(f.ids.get('app').textContent,'Hello World (input preview)');assert.equal(f.ids.get('display-note').hidden,true);
});
test('all local device controls use measured release without native calls, then device change resets',async()=>{
  const f=await fixture({empty:true});
  for(const [profile,control] of [['atoms3r','bezel'],['stickcplus2','device-primary'],['cores3','bezel']]){
    await f.choose('profile',profile);assert.equal(f.ids.get('preview-value').textContent,'Count 0');
    assert.equal(f.ids.get('device-primary').hidden,profile!=='stickcplus2');
    f.down(control,{clientX:420,clientY:280});f.advance(999);await f.up(control);assert.equal(f.ids.get('preview-value').textContent,'Count 1');
    f.down(control,{clientX:420,clientY:280});f.advance(1000);await f.up(control);assert.equal(f.ids.get('preview-value').textContent,'Count 0');
    f.down(control,{clientX:420,clientY:280});f.advance(50);await f.up(control);assert.equal(f.ids.get('preview-value').textContent,'Count 1');
  }
  assert.equal(f.calls.length,0);assert.equal(f.timers.size,0);
});
test('local shake and tilt change indicators without a count multiplier or runtime calls',async()=>{
  const f=await fixture({empty:true,profile:'stickcplus2'});await f.click('primary');assert.equal(f.ids.get('preview-value').textContent,'Count 1');
  await f.click('shake');assert.equal(f.ids.get('preview-value').textContent,'Count 1');assert.ok(f.ids.get('frame').textDraws.some(args=>args[0]==='SHAKE'));
  f.document.querySelectorAll('[data-roll]')[2].dispatch('click');await settle();assert.equal(f.ids.get('roll').textContent,'30°');
  await f.click('primary');assert.equal(f.ids.get('preview-value').textContent,'Count 2');await f.click('reset');assert.equal(f.ids.get('preview-value').textContent,'Count 0');assert.equal(f.ids.get('roll').textContent,'0°');assert.equal(f.calls.length,0);
});
test('Stick display and Core rim/camera do not act as a primary input',async()=>{
  const f=await fixture({empty:true,profile:'stickcplus2'});f.down('bezel',{clientX:420,clientY:280});f.advance(50);await f.up('bezel');assert.equal(f.ids.get('preview-value').textContent,'Count 0');
  await f.choose('profile','cores3');f.down('bezel',{clientX:99,clientY:280});f.advance(50);await f.up('bezel');assert.equal(f.ids.get('preview-value').textContent,'Count 0');
  f.down('device-shell',{clientX:420,clientY:535});f.advance(50);await f.up('device-shell');assert.equal(f.ids.get('preview-value').textContent,'Count 0');assert.equal(f.calls.length,0);
});
test('leaving local gesture by device change, visibility loss or pagehide never sends a late action',async()=>{
  const f=await fixture({empty:true});f.down();f.advance(80);await f.choose('profile','cores3');await f.up();assert.equal(f.ids.get('preview-value').textContent,'Count 0');
  f.down();f.document.hidden=true;f.document.dispatch('visibilitychange');f.advance(80);await f.up();assert.equal(f.ids.get('preview-value').textContent,'Count 0');
  f.document.hidden=false;f.document.dispatch('visibilitychange');f.down();f.window.dispatch('pagehide');await f.up();assert.equal((f.primary().disabled || f.primary().getAttribute('aria-disabled')==='true'),true);assert.equal(f.calls.length,0);
});
test('a verified native frame replaces illustration and enables native-only transport',async()=>{
  const f=await fixture({empty:true,profile:'stickcplus2'});await f.click('primary');assert.equal(f.calls.length,0);
  await f.native({profile:'cores3',sessionId:'native-1'});assert.equal(f.ids.get('display-mode').textContent,'Native app');assert.equal(f.ids.get('display-note').hidden,true);assert.equal(f.ids.get('preview-value').hidden,true);
  assert.equal(f.ids.get('frame').width,320);assert.equal(f.ids.get('session-actions').hidden,false);assert.equal(f.ids.get('preview-value').hidden,true);
  await f.click('primary');assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'m5stack_input');assert.equal(f.calls[0].arguments.sessionId,'native-1');
});
test('native stopped, exited, unavailable and error states never fall back to usable illustration',async()=>{
  for(const status of ['stopped','exited','unavailable']){
    const f=await fixture();await f.update({status});assert.equal(f.ids.get('display-mode').textContent,'Native app');assert.equal((f.primary().disabled || f.primary().getAttribute('aria-disabled')==='true'),true);assert.equal(f.ids.get('preview-value').hidden,true);
    await f.click('primary');await f.click('shake');assert.equal(f.calls.length,0);assert.notEqual(f.ids.get('status').textContent,'Input preview');
  }
  const f=await fixture();await f.error();assert.equal(f.ids.get('display-mode').textContent,'Native app');assert.equal((f.primary().disabled || f.primary().getAttribute('aria-disabled')==='true'),true);assert.match(f.ids.get('message').textContent,/Owned fixture error/);
});
test('unavailable native state hides old pixels and rejects an outstanding decode until a new running frame',async()=>{
  const f=await fixture();const canvas=f.ids.get('frame'),draws=canvas.draws.length;
  f.hold();await f.update({revision:2});await f.update({status:'unavailable',revision:3,nativeState:undefined});
  assert.equal(f.controllers[0].frame,null);assert.equal(f.ids.get('display').hidden,true);assert.equal(f.ids.get('empty').hidden,false);
  assert.equal(f.ids.get('status').textContent,'Unavailable');assert.equal(f.ids.get('preview-value').hidden,true);assert.equal(f.ids.get('revision').textContent,'—');
  await f.release();assert.equal(canvas.draws.length,draws);assert.equal(f.ids.get('display').hidden,true);assert.equal(f.timers.size,0);
  await f.native({status:'running',revision:4});assert.equal(canvas.draws.length,draws+1);assert.equal(f.ids.get('display').hidden,false);assert.equal(f.ids.get('revision').textContent,'4');
});
test('authoritative welcome resets native pixels and rejects a pending native decode',async()=>{
  const f=await fixture();f.hold();await f.update({revision:2});await f.welcome({profile:'stickcplus2'});
  assert.equal(f.ids.get('display-mode').textContent,'Input preview');assert.equal(f.ids.get('profile').value,'stickcplus2');assert.equal(f.ids.get('preview-value').textContent,'Count 0');assert.equal(f.ids.get('revision').textContent,'—');
  const nativeDraws=f.ids.get('frame').draws.length;await f.release();assert.equal(f.ids.get('frame').draws.length,nativeDraws);assert.equal(f.ids.get('display-mode').textContent,'Input preview');assert.equal((f.primary().disabled || f.primary().getAttribute('aria-disabled')==='true'),false);assert.equal(f.timers.size,0);
});
test('failed first native frame preserves illustration label but locks its inputs truthfully',async()=>{
  const f=await fixture({empty:true,badHash:true});await f.native();assert.equal(f.ids.get('display-mode').textContent,'Input preview');assert.match(f.ids.get('display-note').textContent,/Native display pending/);assert.equal(f.ids.get('display-mode').title,'Illustrative input preview');
  assert.equal((f.primary().disabled || f.primary().getAttribute('aria-disabled')==='true'),true);assert.equal(f.ids.get('build-id').textContent,'—');assert.equal(f.ids.get('frame').draws.length,0);await f.click('primary');assert.equal(f.calls.length,0);
});
test('connection failure remains visible when the local illustration is used',async()=>{
  const f=await fixture({rejectConnect:true});assert.equal(f.ids.get('status').textContent,'Not connected');assert.equal(f.ids.get('message').hidden,false);
  await f.click('primary');await f.click('shake');assert.equal(f.ids.get('preview-value').textContent,'Count 1');assert.equal(f.ids.get('status').textContent,'Not connected');assert.match(f.ids.get('message').textContent,/Owned host connection failure/);assert.equal(f.calls.length,0);
});
test('panel contains only simulation controls and runtime inspection, with no guide or chat instructions',()=>{
  const css=readFileSync(new URL('../style.css',import.meta.url),'utf8');
  assert.doesNotMatch(html+'\n'+source+'\n'+css,/coach|createGuide|guideStep|guideDismissed|onboarding|localStorage|sessionStorage|context-status|input-note|device-note|fidelity-note|Tell Codex|What do you want to build|Restart guide|GET STARTED/);
  assert.doesNotMatch(html,/<p\b|<h2[^>]*>[^<]*\?|selection-info|selected-profile-prompt|LOCAL SIMULATOR|Try an input/);
  assert.doesNotMatch(html,/<h1\b/);assert.match(html,/<main class="workbench" aria-label="Device simulator">/);
  assert.equal(existsSync(new URL('../guide.mjs',import.meta.url)),false);
  assert.equal(existsSync(new URL('./guide.test.mjs',import.meta.url)),false);
  assert.match(html,/<span id="preview-value" class="sr-only" role="status">Count 0/);
  assert.match(html,/<details class="diagnostics" name="workbench-menu"><summary title="Runtime" aria-label="Runtime">/);
  assert.doesNotMatch(html,/<details[^>]*\bopen\b/);
  for(const id of ['profile','app','frame','bezel','device-primary','shake','reset','motion','reload','stop','display-mode','message'])assert.match(html,new RegExp('id="'+id+'"'));
});

test('selection context contains device and simulation state only and ignores legacy onboarding metadata',async()=>{
  const f=await fixture({empty:true,modelContext:true});await f.welcome({onboarding:'hardware',guideStep:'identify-hardware'});
  assert.equal(f.contextCalls.length,1);
  assert.deepEqual(Object.keys(f.contextCalls[0].structuredContent).sort(),['selectedProfile','selectedProfileLabel','selectedApp','width','height','mode','runningProfile','sessionId','hardwareConnected'].sort());
  await f.native({sessionId:'native-2'});const count=f.contextCalls.length;assert.ok(count>1);
  await f.update({revision:3,onboarding:'emulator'});assert.equal(f.contextCalls.length,count);
  assert.equal(f.contextCalls.at(-1).structuredContent.mode,'native');assert.equal(f.contextCalls.at(-1).structuredContent.sessionId,'native-2');
  assert.equal(f.ids.has('coach'),false);assert.equal((f.primary().disabled || f.primary().getAttribute('aria-disabled')==='true'),false);
});

test('late authoritative opener updates profile and native context without repeated-frame spam',async()=>{
  const f=await fixture({empty:true,lateOpener:true,modelContext:true});assert.equal(f.contextCalls.length,1);assert.equal(f.contextCalls[0].structuredContent.selectedProfile,'atoms3r');
  await f.welcome({profile:'cores3'});assert.equal(f.contextCalls.length,2);assert.equal(f.contextCalls.at(-1).structuredContent.selectedProfile,'cores3');
  await f.welcome();assert.equal(f.contextCalls.length,2);
  await f.native({profile:'stickcplus2'});assert.equal(f.contextCalls.at(-1).structuredContent.selectedProfile,'stickcplus2');assert.equal(f.contextCalls.at(-1).structuredContent.mode,'native');
  const count=f.contextCalls.length;await f.update({revision:7});assert.equal(f.contextCalls.length,count);
});

test('Codex app opens and reload stay interactive and publish committed session context',async()=>{
  const f=await fixture({profile:'cores3',modelContext:true});
  await f.native({app:'custom',sessionId:'opened-custom'});assert.equal(f.calls.some(call=>call.name==='m5stack_select'),false);
  assert.equal(f.ids.get('app').textContent,'custom');assert.equal(f.ids.get('app').tagName,'OUTPUT');assert.equal(f.ids.get('display-mode').textContent,'Native app');
  const prior=f.contextCalls.at(-1).structuredContent.sessionId;await f.click('reload');
  assert.equal(f.calls.at(-1).name,'m5stack_reload');assert.notEqual(f.contextCalls.at(-1).structuredContent.sessionId,prior);
  assert.equal((f.primary().disabled || f.primary().getAttribute('aria-disabled')==='true'),false);assert.equal(f.ids.get('frame').width,320);
  const beforeReset=f.controllers[0].state.sessionId;await f.click('reset');assert.equal(f.calls.at(-1).name,'m5stack_reload');assert.notEqual(f.controllers[0].state.sessionId,beforeReset);
  f.document.querySelectorAll('[data-roll]')[0].dispatch('click');await settle();
  assert.equal(f.calls.at(-1).arguments.event.type,'tilt');assert.equal(f.calls.at(-1).arguments.event.degrees,-30);
  await f.click('shake');assert.equal(f.calls.at(-1).arguments.event.type,'shake');
});

for(const control of ['reset','device-rst'])test(control+' can recover an exited or failed native worker but cannot restart a stopped session',async()=>{
  const f=await fixture({profile:'cores3se'});
  await f.update({status:'exited'});assert.equal(f.ids.get(control).disabled,false);
  await f.click(control);assert.equal(f.calls.at(-1).name,'m5stack_reload');assert.equal(f.controllers[0].state.status,'running');
  await f.error();assert.equal(f.controllers[0].faulted,true);assert.equal(f.ids.get(control).disabled,false);
  await f.click(control);assert.equal(f.controllers[0].faulted,false);assert.equal(f.calls.at(-1).name,'m5stack_reload');
  await f.click('stop');assert.equal(f.ids.get(control).disabled,true);
  const calls=f.calls.length;await f.click(control);assert.equal(f.calls.length,calls);f.bridge.onteardown();
});

test('primary control is only on the device, with key and pointer pressed feedback on all profiles',async()=>{
  const f=await fixture({empty:true});
  assert.equal(f.ids.has('primary'),false);assert.equal(f.ids.has('primary-label'),false);
  for(const profile of ['atoms3r','stickcplus2','cores3']){
    await f.choose('profile',profile);const control=f.primary();
    assert.equal(control.hidden,false);
    if(profile==='stickcplus2')assert.equal(control.disabled,false);
    else assert.equal(control.getAttribute('tabindex'),'0');
    f.keyDown('a');assert.equal(control.dataset.pressed,'true');f.advance(75);await f.keyUp('a');
    assert.equal(control.dataset.pressed,'false');assert.equal(f.ids.get('preview-value').textContent,'Count 1');
    f.down();assert.equal(control.dataset.pressed,'true');f.advance(1000);await f.up();
    assert.equal(control.dataset.pressed,'false');assert.equal(f.ids.get('preview-value').textContent,'Count 0');
    f.advance(800);const event=f.keyDown('Enter',{target:control});assert.equal(event.defaultPrevented,true);f.advance(60);await f.keyUp('Enter');
    assert.equal(f.ids.get('preview-value').textContent,'Count 1');
  }
  assert.equal(f.calls.length,0);
});
test('pressed feedback clears on focus loss, pointer cancellation, device changes and pagehide',async()=>{
  const f=await fixture({empty:true});const cap=f.primary();
  f.keyDown(' ');f.document.dispatch('focusin');assert.equal(cap.dataset.pressed,'false');await f.keyUp(' ');assert.equal(f.ids.get('preview-value').textContent,'Count 0');
  f.down();cap.dispatch('pointercancel');assert.equal(cap.dataset.pressed,'false');
  f.down();await f.choose('profile','stickcplus2');assert.equal(cap.dataset.pressed,'false');
  f.keyDown('a');const button=f.primary();f.window.dispatch('pagehide');assert.equal(button.dataset.pressed,'false');await f.keyUp('a');
  assert.equal(f.ids.get('preview-value').textContent,'Count 0');
});
test('shake/reset feedback is short lived and tilt reports the selected angle',async()=>{
  const f=await fixture({empty:true});await f.click('shake');assert.equal(f.ids.get('shake').dataset.active,'true');f.expireFeedback();assert.equal(f.ids.get('shake').dataset.active,'false');
  f.document.querySelectorAll('[data-roll]')[2].dispatch('click');await settle();
  assert.equal(f.ids.get('roll').textContent,'30°');assert.equal(f.document.querySelectorAll('[data-roll]')[2].getAttribute('aria-pressed'),'true');
  await f.click('reset');assert.equal(f.ids.get('reset').dataset.active,'true');assert.equal(f.ids.get('roll').textContent,'0°');
  f.window.dispatch('pagehide');assert.equal(f.ids.get('reset').dataset.active,'false');
});
test('resize recomputes device geometry without changing native pixels and disconnects on pagehide',async()=>{
  const f=await fixture({profile:'cores3'});const frame=f.ids.get('frame'),shell=f.ids.get('device-shell');
  const draws=frame.draws.length;
  for(const [width,height] of [[296,320],[552,540],[952,640]]){
    f.resize(width,height);const layout=deviceLayout('cores3',width,height);
    assert.equal(shell.style.width,layout.width+'px');assert.equal(shell.style.height,layout.height+'px');
    assert.equal(f.ids.get('bezel').style.width,layout.screen.width+'px');
    assert.equal(frame.width,320);assert.equal(frame.height,240);assert.equal(frame.draws.length,draws);
  }
  assert.equal(f.observers[0].node,f.ids.get('stage'));f.window.dispatch('pagehide');assert.equal(f.observers[0].disconnected,true);
});
test('healthy preview mode is shown once and keyboard shortcuts leave secondary controls alone',async()=>{
  const f=await fixture({empty:true});assert.equal(f.ids.get('status').hidden,true);
  for(const target of [f.ids.get('profile'),f.ids.get('shake'),f.all.find(node=>node.tagName==='SUMMARY')]){
    f.keyDown(' ',{target});f.advance(40);await f.keyUp(' ');
  }
  assert.equal(f.ids.get('preview-value').textContent,'Count 0');
  await f.native();assert.equal(f.ids.get('status').hidden,false);assert.equal(f.ids.get('status').textContent,'Running');
});
test('A and Space follow the current device after a focused primary surface becomes inactive; Enter stays inert',async()=>{
  const f=await fixture({empty:true});const oldCap=f.primary();
  await f.welcome({profile:'stickcplus2'});
  f.keyDown('Enter',{target:oldCap});f.advance(50);await f.keyUp('Enter');assert.equal(f.ids.get('preview-value').textContent,'Count 0');
  for(const key of ['a',' ']){
    f.keyDown(key,{target:oldCap});assert.equal(f.ids.get('device-primary').dataset.pressed,'true');f.advance(50);await f.keyUp(key);
  }
  assert.equal(f.ids.get('preview-value').textContent,'Count 2');
  const oldButton=f.primary();await f.welcome({profile:'cores3'});
  f.keyDown('Enter',{target:oldButton});f.advance(50);await f.keyUp('Enter');assert.equal(f.ids.get('preview-value').textContent,'Count 0');
  f.keyDown('a',{target:oldButton});assert.equal(f.ids.get('bezel').dataset.pressed,'true');f.advance(50);await f.keyUp('a');assert.equal(f.ids.get('preview-value').textContent,'Count 1');
  await f.native({profile:'atoms3r'});await f.native({profile:'stickcplus2'});
  f.keyDown(' ',{target:oldCap});f.advance(75);await f.keyUp(' ');assert.equal(f.calls.length,1);assert.equal(f.calls[0].arguments.event.durationMs,75);
});

test('visible device pose follows local state and verified native acknowledgement',async()=>{
  const f=await fixture({empty:true});f.document.querySelectorAll('[data-roll]')[0].dispatch('click');await settle();
  assert.equal(f.ids.get('device-shell').style.transform,'rotate(-30deg)');await f.click('reset');assert.equal(f.ids.get('device-shell').style.transform,'rotate(0deg)');
  await f.native({profile:'cores3',rollDegrees:30});assert.equal(f.ids.get('device-shell').style.transform,'rotate(30deg)');
  f.hold();await f.update({revision:40,rollDegrees:-30});assert.equal(f.ids.get('device-shell').style.transform,'rotate(30deg)','pending frame does not set pose');
  await f.release();assert.equal(f.ids.get('device-shell').style.transform,'rotate(-30deg)');
});
for(const profile of ['cores3','cores3se'])test(profile+' POWER emits gated events and RST restarts the worker',async()=>{
  const f=await fixture({profile,powerAdapter:true,appAdapter:true});
  assert.equal(f.ids.get('device-power').hidden,false);assert.equal(f.ids.get('device-rst').hidden,false);
  await f.click('device-power');await f.click('power-hold');await f.click('device-rst');
  assert.deepEqual(f.calls.filter(c=>c.name==='m5stack_input').map(c=>JSON.parse(JSON.stringify(c.arguments.event))),[{type:'power',action:'click'},{type:'power',action:'hold'}]);
  assert.equal(f.calls.at(-1).name,'m5stack_reload');assert.equal(f.calls.at(-1).arguments.sessionId,'session-1');assert.equal(f.controllers[0].state.sessionId,'session-2');
  await f.native({app:'legacy-worker',sessionId:'opened-legacy'});assert.equal(f.ids.get('device-power').disabled,true);assert.equal(f.ids.get('power-hold').disabled,true);
  const n=f.calls.length;await f.click('device-power');assert.equal(f.calls.length,n);
  await f.choose('profile','atoms3r');assert.equal(f.ids.get('device-power').hidden,true);assert.equal(f.ids.get('device-rst').hidden,true);assert.equal(f.ids.get('power-hold').hidden,true);
});

test('legacy Core worker cannot dispatch POWER, while workspace-free preview needs no tool',async()=>{
  const legacy=await fixture({profile:'cores3se'});assert.equal(legacy.ids.get('device-power').disabled,true);
  await legacy.click('device-power');await legacy.click('power-hold');assert.equal(legacy.calls.length,0);
  const f=await fixture({profile:'cores3se',empty:true});assert.equal(f.ids.get('device-power').disabled,false);
  await f.click('primary');assert.equal(f.ids.get('preview-value').textContent,'Count 1');
  await f.click('device-power');await f.click('power-hold');assert.equal(f.ids.get('preview-value').textContent,'Count 1');
  assert.ok(f.ids.get('frame').textDraws.some(draw=>draw[0]==='POWER hold'));
  await f.click('device-rst');assert.equal(f.ids.get('preview-value').textContent,'Count 0');assert.equal(f.calls.length,0);
});

test('host media diagnostics distinguish advertisement and policy without starting media',async()=>{
  const f=await fixture({profile:'cores3se',empty:true,hostCapabilities:{sandbox:{permissions:{microphone:{}}}},microphonePolicy:false});
  const text=f.ids.get('media-support').textContent;
  assert.match(text,/advertised.*consent/);assert.match(text,/Microphone policy: blocked/);assert.match(text,/Secure context: yes/);assert.match(text,/AudioContext: available/);
  assert.equal(f.mediaRequests.length,0);assert.equal(f.mediaContexts.length,0);assert.equal(f.pcmContexts.length,0);
  const unknown=await fixture({profile:'cores3se',empty:true,rejectHostCapabilities:true});
  assert.match(unknown.ids.get('media-support').textContent,/not reported/);assert.match(unknown.ids.get('media-support').textContent,/Microphone policy: unknown/);
  assert.equal(unknown.ids.get('message').hidden,true);assert.equal(unknown.mediaRequests.length,0);
});

test('sound diagnostics sanitize unknown host names and preserve unknown activation',async()=>{
  const f=await fixture({profile:'cores3se',empty:true,rejectAudioResume:true,audioResumeErrorName:'Untrusted host name'});
  await f.click('sound-toggle');await f.click('sound-toggle');
  assert.match(f.ids.get('media-support').textContent,/error OtherError; user activation unknown/);
  assert.doesNotMatch(f.ids.get('media-support').textContent,/Untrusted/);
  assert.equal(f.mediaRequests.length,0);f.bridge.onteardown();
});

test('one device action clicked during a frame poll is delivered after that poll exactly once',async()=>{
  const f=await fixture({profile:'cores3',appAdapter:true,mediaAdapter:true});f.holdPoll();await f.poll();
  await f.click('primary');await f.click('primary');
  assert.equal(f.calls.filter(call=>call.name==='m5stack_input').length,0);
  await f.releasePoll();assert.equal(f.calls.filter(call=>call.name==='m5stack_input').length,1);f.bridge.onteardown();
});
test('Hello World screen input cannot request microphone access or make a waveform',async()=>{
  const f=await fixture({empty:true,profile:'cores3se',allowMic:true});await f.click('primary');
  assert.equal(f.ids.get('preview-value').textContent,'Count 1');assert.equal(f.mediaRequests.length,0);
  assert.equal(f.ids.get('voice-waveform').dataset.state,'idle');f.bridge.onteardown();
});

test('an idle app gets availability without listening and can request audio only within the armed session',async()=>{
  const f=await fixture({profile:'cores3se',mediaAdapter:true,appAdapter:true,audioInputAdapter:true,nativeState:{audio_input:{requested:false}}});
  await f.click('primary');assert.equal(f.liveMicInstances[0].state.status,'armed');
  assert.equal(f.ids.get('mic-status').textContent,'Ready');
  await f.update({nativeState:{audio_input:{requested:true}}});assert.equal(f.liveMicInstances[0].state.status,'active');
  await f.update({nativeState:{audio_input:{requested:false}}});assert.equal(f.liveMicInstances[0].state.status,'armed');
  f.document.hidden=true;f.document.dispatch('visibilitychange');await settle();
  assert.equal(f.liveMicInstances[0].state.armed,false);
  f.document.hidden=false;f.document.dispatch('visibilitychange');await settle();
  await f.update({nativeState:{audio_input:{requested:true}}});assert.equal(f.liveMicInstances[0].enables.length,1);
  assert.equal(f.ids.get('mic-status').textContent,'Off');
});
test('poll and UI notifications do not replay cached microphone demand after a native stop',async()=>{
  const f=await fixture({profile:'cores3se',mediaAdapter:true,appAdapter:true,audioInputAdapter:true});
  await f.click('primary');
  const microphone=f.liveMicInstances[0];assert.equal(microphone.state.requested,true);
  assert.equal(microphone.requests.at(-1).revision,f.controllers[0].state.revision);
  // An audio acknowledgment is newer than the last framebuffer snapshot.
  microphone.state={...microphone.state,requested:false,status:'armed',receivedFrames:160000};
  f.holdPoll();await f.poll();
  assert.equal(microphone.state.requested,false,'starting a poll must not restore the old frame demand');
  f.controllers[0].notify();
  assert.equal(microphone.state.requested,false,'unrelated rendering must not restore the old frame demand');
  await f.update({nativeState:{audio_input:{requested:false}}});await f.releasePoll();
  assert.equal(microphone.state.requested,false);
  await f.update({nativeState:{audio_input:{requested:true}}});
  assert.equal(microphone.state.requested,true,'later authoritative app demand remains supported');
  f.bridge.onteardown();
});
test('switch and reload disarm PCM while Atom never offers microphone input',async()=>{
  const f=await fixture({profile:'cores3se',mediaAdapter:true,appAdapter:true,audioInputAdapter:true});
  await f.click('primary');await f.click('reload');assert.equal(f.liveMicInstances[0].state.armed,false);
  await f.click('primary');await f.choose('profile','atoms3r');assert.equal(f.liveMicInstances[0].state.armed,false);
  assert.equal(f.ids.get('microphone-controls').hidden,true);
  const starts=f.liveMicInstances[0].enables.length;await f.click('primary');assert.equal(f.liveMicInstances[0].enables.length,starts);
});

// Regression: ordinary speech is visible without changing the app's input gain.
test('device gesture prepares PCM silently, app demand starts/stops it, and hide requires a fresh gesture',async()=>{
  const f=await fixture({profile:'cores3se',mediaAdapter:true,appAdapter:true,audioInputAdapter:true,nativeState:{audio_input:{requested:false}}});
  assert.equal(f.liveMicInstances[0].enables.length,0);
  await f.click('primary');
  assert.equal(f.liveMicInstances[0].enables.length,1);
  assert.equal(f.liveMicInstances[0].enables[0].requested,false);
  assert.equal(f.liveMicInstances[0].state.status,'armed');
  await f.update({nativeState:{audio_input:{requested:true}}});assert.equal(f.liveMicInstances[0].state.status,'active');
  await f.update({nativeState:{audio_input:{requested:false}}});assert.equal(f.liveMicInstances[0].state.status,'armed');
  f.document.hidden=true;f.document.dispatch('visibilitychange');await settle();
  f.document.hidden=false;f.document.dispatch('visibilitychange');await settle();
  await f.update({nativeState:{audio_input:{requested:true}}});
  assert.equal(f.liveMicInstances[0].state.armed,false);
  assert.equal(f.liveMicInstances[0].enables.length,1);f.bridge.onteardown();
});

// The default shell never turns a fixture or sample workflow into hardware UI.
test('all profiles keep app loading and fixture workflows out of the emulator controls',async()=>{
  for(const profile of profiles)for(const mode of ['preview','legacy','pcm']){
    const f=await fixture({profile:profile.id,empty:mode==='preview',mediaAdapter:true,appAdapter:true,audioInputAdapter:mode==='pcm'});
    for(const id of ['image-controls','image-file','image-clear','mic-source','mic-synthetic','mic-toggle','record-toggle','record-fixture','record-discard','voice-review','voice-confirm','voice-transcript','sound-test'])assert.equal(f.ids.has(id),false,profile.id+': '+mode+' '+id);
    assert.equal(f.all.some(node=>node.tagName==='INPUT' && node.getAttribute('type')==='file'),false);
    assert.equal(f.ids.get('app').tagName,'OUTPUT');
    assert.equal(f.ids.get('reset').hidden,mode!=='preview');
    assert.equal(f.liveMicInstances[0].enables.length,0,'opening never captures');
    f.bridge.onteardown();
  }
});
for(const profile of ['stickcplus2','cores3','cores3se'])test(profile+' app-owned microphone survives device input, but session replacement disarms it',async()=>{
  const f=await fixture({profile,mediaAdapter:true,appAdapter:true,audioInputAdapter:true,nativeState:{audio_input:{requested:false}}});
  await f.click('primary');assert.equal(f.liveMicInstances[0].state.status,'armed');
  await f.update({nativeState:{audio_input:{requested:true}}});assert.equal(f.liveMicInstances[0].state.status,'active');
  const before=f.calls.filter(call=>call.name==='m5stack_input').length;
  await f.click('primary');assert.equal(f.calls.filter(call=>call.name==='m5stack_input').length,before+1);assert.equal(f.liveMicInstances[0].state.status,'active');
  await f.native({sessionId:'replacement',app:'custom',nativeState:{audio_input:{requested:false}}});
  assert.equal(f.liveMicInstances[0].state.armed,false);f.bridge.onteardown();
});

for(const profile of ['stickcplus2','sticks3','cores3','cores3se'])test(profile+' defaults to gesture-started sound and preserves explicit mute',async()=>{
  const f=await fixture({profile,mediaAdapter:true,appAdapter:true});
  assert.equal(f.mediaContexts.length,0,'opening does not autoplay');
  assert.equal(f.ids.get('sound-status').textContent,'Ready · tap device');
  assert.equal(f.ids.get('sound-toggle').getAttribute('aria-label'),'Mute');
  await f.click('primary');
  assert.equal(f.mediaInstances[0].state.sound.enabled,true);
  assert.equal(f.ids.get('sound-status').textContent,'On');
  assert.equal(f.mediaRequests.length,0,'speaker activation never requests a microphone');
  await f.update({revision:10,nativeState:{app_sound:{id:1,frequency_hz:600,duration_ms:80}}});
  assert.equal(f.mediaContexts[0].tones.length,1,'new app cue reaches the speaker');
  await f.click('sound-toggle');
  const contexts=f.mediaContexts.length;
  await f.click('primary');await f.click('reload');await f.click('primary');
  await f.choose('profile',profile==='cores3'?'cores3se':'cores3');await f.click('primary');
  assert.equal(f.ids.get('sound-status').textContent,'Muted');
  assert.equal(f.mediaContexts.length,contexts,'device input and replacement cannot override mute');
  await f.click('sound-toggle');assert.equal(f.mediaInstances[0].state.sound.enabled,true);
  f.bridge.onteardown();
});
test('sound may be muted before any gesture and Atom never creates an output context',async()=>{
  const f=await fixture({profile:'cores3se',mediaAdapter:true});
  await f.click('sound-toggle');await f.click('primary');assert.equal(f.mediaContexts.length,0);
  await f.choose('profile','atoms3r');await f.click('primary');assert.equal(f.mediaContexts.length,0);
  assert.equal(f.ids.get('sound-controls').hidden,true);f.bridge.onteardown();
});
test('default sound stops on hide and resumes only after a new device gesture',async()=>{
  const f=await fixture({profile:'cores3se',mediaAdapter:true});await f.click('primary');
  f.document.hidden=true;f.document.dispatch('visibilitychange');await settle();
  assert.equal(f.mediaInstances[0].state.sound.enabled,false);
  f.document.hidden=false;f.document.dispatch('visibilitychange');await settle();await f.poll();
  assert.equal(f.mediaContexts.length,1);assert.equal(f.ids.get('sound-status').textContent,'Ready · tap device');
  await f.click('primary');assert.equal(f.mediaContexts.length,2);assert.equal(f.mediaInstances[0].state.sound.enabled,true);
  f.bridge.onteardown();
});
