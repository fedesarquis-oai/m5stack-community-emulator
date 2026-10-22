import {App,applyDocumentTheme,applyHostStyleVariables} from '@modelcontextprotocol/ext-apps';
import {OpenAIExtensions} from '@openai/mcp-extensions/app';
import {WorkbenchController,pressDuration} from './controller.mjs';
import {INPUT_PREVIEW_CATALOG,createInputPreview,applyPreviewInput,drawInputPreview} from './input-preview.mjs';
import {deviceLayout} from './device-layout.mjs';
import {DeviceMotion} from './device-motion.mjs';
import {DeviceMedia} from './device-media.mjs';
import {readHostMediaSupport} from './host-media-support.mjs';
import {LiveMicrophone} from './live-microphone.mjs';
import './style.css';

// Release contracts: ext-apps 1.7.5 and mcp-extensions 0.1.0.
const PLUGIN_VERSION='0.7.42';
const app=new App({name:'M5Stack Community Emulator',version:PLUGIN_VERSION},{availableDisplayModes:['fullscreen']});
const extensions=new OpenAIExtensions(app);
const $=id=>document.getElementById(id);
const profilePicker=$('profile'),canvas=$('frame'),bezel=$('bezel');
let catalogKey='',paintedKey='',decodeEpoch=0,drawing=false,drawError='',committed=null;
let gesture=null,suppressClickUntil=0;
let chosenProfile=null,contextBusy=false,pendingContext=null;
let inputPreview=null,previewPainted=false;
let connectionError='';
let hostConnected=false,lastContextKey='';
let hostMediaSupport=null;
let displayedProfile='atoms3r';
let media=null,mediaContextKey='';
// Keep the user's mute choice separate from a context stopped by lifecycle.
// Default output starts only from a device gesture, never from rendering.
let soundWanted=true;
let waveSource=null,waveLevel=0,waveHistory=Array(24).fill(0);
let liveMic=null,microphoneRequestState=null;
const actionTimers=new Map();
const stripControls=[$('device-touch-a'),$('device-touch-b'),$('device-touch-c')];
const primaryControls=[bezel,$('device-primary'),$('device-secondary'),...stripControls];
const controller=new WorkbenchController({
  call:request=>app.callServerTool(request,{timeout:15000}),
  onChange:()=>render(),
});
const motion=new DeviceMotion($('device-shell'),{onLayout:sizeDevice});
media=new DeviceMedia({document,window,onState:()=>updateMediaControls()});
liveMic=new LiveMicrophone({window,document,
  call:(name,args)=>app.callServerTool({name,arguments:args},{timeout:5000}),
  onState:()=>updateMediaControls(),onDiagnostic:()=>updateMediaControls(),
  onLevel:level=>sampleWaveform(level,'pcm')});
function previewMode(){return !controller.state?.sessionId;}
function usesPcmInput(){return !previewMode() && caps().audioInputAdapter===1 && caps().microphonePcm===true;}
function appRequestsMicrophone(){return usesPcmInput() && controller.state?.nativeState?.audio_input?.requested===true;}
function caps(){return previewMode()?(selectedProfile() || {}):(controller.state?.capabilities || {});}
function primaryKind(){return caps().primaryInput || caps().primary_input;}
function catalogProfiles(){return Array.isArray(controller.catalog?.profiles)?controller.catalog.profiles:INPUT_PREVIEW_CATALOG.profiles;}
function selectedProfile(){return catalogProfiles().find(item=>item.id===(chosenProfile || controller.state?.profile || profilePicker.value)) || catalogProfiles()[0];}
function inputSession(){return controller.state?.sessionId || 'input-preview:'+selectedProfile()?.id;}
function currentDisplayReady(){
  const state=controller.state;
  return previewMode()?previewPainted:Boolean(committed && committed.sessionId===state?.sessionId &&
    committed.profile===state.profile && committed.buildId===state.buildId);
}
function readyForInput(){
  return (previewMode()?controller.active && controller.visible && !controller.faulted && !controller.busy:controller.canInput) &&
    currentDisplayReady() && !drawError && !document.hidden;
}
function readyForMedia(){
  // Host audio settings stay interactive during background frame polling.
  return (previewMode()?controller.active && controller.visible && !controller.faulted:controller.ready) &&
    !Object.keys(controller.desired).length && !controller.queue.some(item=>item.name==='m5stack_reload') &&
    !['m5stack_select','m5stack_reload'].includes(controller.requestName) &&
    currentDisplayReady() && !drawError && !document.hidden;
}
function setDeviceShape(profile){
  displayedProfile=profile.id;
  $('device-shell').dataset.profile=profile.id;
  $('case-label').textContent={atoms3r:'ATOM S3R',stickcplus2:'M5StickC PLUS2',sticks3:'STICK S3',cores3:'M5Stack CoreS3',cores3se:'M5Stack CoreS3 SE'}[profile.id] || profile.label;
  canvas.style.aspectRatio=profile.width+'/'+profile.height;
  sizeDevice();
  $('dimensions').textContent=profile.width+' × '+profile.height;
}
function sizeDevice(){
  const bounds=$('stage').getBoundingClientRect();
  const layout=deviceLayout(displayedProfile,bounds.width,bounds.height,{rollDegrees:motion.layoutRollDegrees});if(!layout)return;
  const shell=$('device-shell');
  shell.style.width=layout.width+'px';shell.style.height=layout.height+'px';
  bezel.style.left=layout.screen.x+'px';bezel.style.top=layout.screen.y+'px';
  bezel.style.width=layout.screen.width+'px';bezel.style.height=layout.screen.height+'px';
  if(layout.touchStrip){
    const strip=$('device-touch-strip');
    strip.style.left=layout.touchStrip.x+'px';strip.style.top=layout.touchStrip.y+'px';
    strip.style.width=layout.touchStrip.width+'px';strip.style.height=layout.touchStrip.height+'px';
  }
}
function primaryControl(){return (controller.state?.sessionId?controller.state.profile:selectedProfile()?.id)==='stickcplus2'||(controller.state?.sessionId?controller.state.profile:selectedProfile()?.id)==='sticks3'?$('device-primary'):bezel;}
function flashAction(control){
  clearTimeout(actionTimers.get(control));control.dataset.active='true';
  actionTimers.set(control,setTimeout(()=>{control.dataset.active='false';actionTimers.delete(control);},320));
}
function clearActionFeedback(){
  for(const [control,timer] of actionTimers){clearTimeout(timer);control.dataset.active='false';}
  actionTimers.clear();
}
function paintPreview(){
  const profile=selectedProfile();if(!profile)return;
  if(!inputPreview || inputPreview.profile!==profile.id)inputPreview=createInputPreview(profile);
  try{
    drawInputPreview(canvas,inputPreview,profile);setDeviceShape(profile);previewPainted=true;
    canvas.setAttribute('aria-label','Illustrative Hello World input preview');
    $('display-mode').textContent='Input preview';$('display-mode').title='Illustrative input preview';$('display-note').hidden=true;
    $('preview-value').hidden=false;$('preview-value').textContent='Count '+inputPreview.count;
    $('roll').textContent=inputPreview.rollDegrees+'°';
    motion.setRoll(inputPreview.rollDegrees);
    document.querySelectorAll('[data-roll]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.roll)===inputPreview.rollDegrees)));
  }catch(error){drawError=error.message || 'The input preview could not be drawn.';}
}
function sendInput(event){
  if(!readyForInput())return false;
  if(!previewMode()){
    if(soundWanted && caps().audioOutput!=='none' &&
       !media.state.sound.enabled && media.state.sound.status!=='enabling' &&
       !((event.type==='primary' || event.type==='secondary') && event.durationMs>=1000) &&
       !(event.type==='power' && event.action==='hold'))void media.enableSound();
    // Prepare silently inside the device gesture. Native app demand, not the
    // emulator's rendering or a sample-specific control, gates actual capture.
    if(usesPcmInput() && !liveMic.state.armed &&
       (((event.type==='primary' || event.type==='secondary') && event.durationMs<1000) || event.type==='swipe' || (event.type==='power' && event.action==='click')))
      void liveMic.enable({sessionId:inputSession(),requested:false});
    const accepted=controller.input(event);
    return accepted;
  }
  if(!applyPreviewInput(inputPreview,selectedProfile(),event))return false;
  paintPreview();updateControls();return true;
}
function syncMediaContext(){
  const profile=controller.state?.sessionId?controller.state.profile:selectedProfile()?.id;
  const key=inputSession();
  if(mediaContextKey===key)return;
  liveMic?.disable('session-change');
  mediaContextKey=key;
  media.setProfile(profile);media.setSession(key);
}
function stopMedia(reason){liveMic?.disable(reason);media?.stopAll(reason);}
function setAudioButton(id,label,active){
  $(id+'-label').textContent=label;$(id).setAttribute('aria-label',label);$(id).title=label;
  $(id).dataset.active=String(Boolean(active));
}
// Display only: map RMS amplitude onto a -60..0 dBFS meter. Never apply
// this curve to samples, input events, capture buffers or transport payloads.
function microphoneMeterLevel(rms){
  if(!Number.isFinite(rms)||rms<=0.001)return 0;
  return Math.min(1,Math.max(0,(20*Math.log10(rms)+60)/60));
}
function sampleWaveform(level,source){
  if(!Number.isFinite(level))return;
  if(source!==waveSource){waveSource=source;waveHistory.fill(0);}
  waveLevel=Math.max(0,Math.min(1,level));waveHistory.shift();waveHistory.push(waveLevel);
  updateAudioActivity();
}
function updateAudioActivity(){
  if(!media)return;
  const pcm=usesPcmInput(),input=liveMic?.state,active=pcm&&input?.status==='active';
  const source=active?'pcm':null;
  if(!source||waveSource!==source){waveSource=source;waveHistory.fill(0);waveLevel=0;}
  $('voice-waveform').dataset.state=source||'idle';
  for(let i=0;i<waveHistory.length;i++)$('voice-wave-'+i).style.height=(3+29*microphoneMeterLevel(waveHistory[i]))+'px';
  $('mic-meter').value=microphoneMeterLevel(waveLevel);$('mic-level').textContent=Math.round(microphoneMeterLevel(waveLevel)*100)+'%';
  $('mic-status').textContent=!pcm?'Unavailable':input?.error?'Error':active?'Listening':input?.armed?(appRequestsMicrophone()?'Starting…':'Ready'):'Off';
  $('mic-indicator').hidden=!active;
  $('microphone-app-status').textContent=!pcm?'This app does not provide live microphone input.':active?(input.receivedFrames>0?'Audio is reaching the device app.':'Waiting for audio samples…'):input?.armed&&appRequestsMicrophone()?'Connecting microphone…':'Controlled by the device app.';
}
function updateMediaControls(){
  if(!media)return;
  const state=media.state,cap=caps(),ready=readyForMedia();
  const microphone=Boolean(cap.microphone),output=cap.audioOutput || 'none';
  const pcm=usesPcmInput(),pcmState=liveMic?.state;
  $('media-controls').hidden=!microphone && output==='none';
  $('microphone-controls').hidden=!microphone;$('sound-controls').hidden=output==='none';
  $('sound-heading').textContent=output==='buzzer'?'Buzzer':'Speaker';
  $('sound-toggle').disabled=output==='none' || (!ready && !soundWanted && !state.sound.enabled);
  setAudioButton('sound-toggle',state.sound.error?'Retry sound':soundWanted?'Mute':'Unmute',soundWanted);
  $('sound-volume').value=String(Math.round(state.sound.volume*100));$('sound-volume').disabled=output==='none';
  $('sound-volume-value').textContent=Math.round(state.sound.volume*100)+'%';
  $('sound-status').textContent=state.sound.error?'Error':!soundWanted?'Muted':state.sound.enabled?'On':state.sound.status==='enabling'?'Starting…':'Ready · tap device';
  const message=[['Microphone',pcm?pcmState??{}:state.mic],['Sound',state.sound]].filter(([,value])=>value.error)
    .map(([label,value])=>label+': '+value.error+(value.errorCode?' ['+value.errorCode+']':'' )).join('\n');
  $('media-message').textContent=message;$('media-message').hidden=!message;
  const supportLines=hostMediaSupport?[
    'Host mic permission: '+(hostMediaSupport.hostMicrophone==='advertised'?'advertised (user consent still required)':'not reported'),
    'Microphone policy: '+hostMediaSupport.microphonePolicy,
    'Secure context: '+(hostMediaSupport.secureContext===null?'unknown':hostMediaSupport.secureContext?'yes':'no'),
    'AudioContext: '+(hostMediaSupport.audioContextAvailable?'available':'unavailable'),
    'AudioWorklet: '+(hostMediaSupport.audioWorkletAvailable?'available':'unavailable'),
    'Microphone API: '+(hostMediaSupport.getUserMediaAvailable?'available':'unavailable'),
  ]:['Host media capabilities not yet reported.'];
  if(cap.speakerPcm)supportLines.push('Speaker PCM: '+state.sound.pcmFrames+' samples scheduled; '+state.sound.pcmDiscontinuities+' discontinuities');
  for(const [label,value] of [['Sound',state.sound]]){
    const attempt=value.resumeDiagnostic;
    supportLines.push(attempt?label+' resume: '+attempt.outcome+
      '; context '+attempt.initialState+' → '+attempt.finalState+
      '; error '+(attempt.errorName??'none reported')+
      '; user activation '+(attempt.userActivation===null?'unknown':attempt.userActivation?'active':'inactive'):
      label+' resume: not attempted');
  }
  if(pcm){
    supportLines.push('Device microphone: PCM16 · 16000 Hz · mono',
      'Meter scale: logarithmic −60 to 0 dBFS; audio gain unchanged',
      'App requests microphone: '+(appRequestsMicrophone()?'yes':'no'),
      'Browser input: '+(pcmState?.status??'off'),
      'Native accepted samples this stream: '+(pcmState?.receivedFrames??0),
      'App processed samples: '+(controller.state?.nativeState?.audio_input?.received_frames??'not reported'),
      'Microphone transport: local PCM, up to 5 minutes; app services are separate');
    for(const attempt of liveMic?.diagnostics??[]){
      const details=['echoCancellation','noiseSuppression','autoGainControl'].filter(key=>typeof attempt[key]==='boolean').map(key=>key+'='+attempt[key]);
      supportLines.push('  Device input '+attempt.stage+': '+attempt.outcome+(attempt.errorCode?'; '+attempt.errorCode:'')+(details.length?'; '+details.join(', '):''));
    }
  }
  $('media-support').textContent=['Plugin version: '+PLUGIN_VERSION,...supportLines].join('\n');
  updateAudioActivity();
}
function consumeAppSound(state){
  if(state.capabilities?.speakerPcm)media.acceptAppPcm({sessionId:state.sessionId,packet:state.nativeState?.speaker_output});
  for(const [channel,tone] of [['app',state.nativeState?.app_sound],['diagnostic',state.nativeState?.output_tone]]){
    media.acceptAppTone({sessionId:state.sessionId,channel,cueId:tone?.id ?? 0,frequencyHz:tone?.frequency_hz ?? 660,durationMs:tone?.duration_ms ?? 90});
  }
}
function attachSelection(){
  const profile=selectedProfile();if(!profile || !controller.active || !hostConnected)return;
  const selectedApp=previewMode()?'counter':controller.state?.app || null;
  const value={structuredContent:{selectedProfile:profile.id,selectedProfileLabel:profile.label,selectedApp,width:profile.width,height:profile.height,
    mode:previewMode()?'input-preview':'native',runningProfile:controller.state?.sessionId?controller.state.profile:null,sessionId:controller.state?.sessionId || null,hardwareConnected:false},
    content:[{type:'text',text:'Selected M5Stack preview: '+profile.label+' ('+profile.id+'). Selected app: '+(selectedApp || 'not started')+'. No hardware is connected.'}]};
  const key=JSON.stringify(value.structuredContent);if(key===lastContextKey)return;
  lastContextKey=key;pendingContext=value;
  void publishSelection();
}
async function publishSelection(){
  if(contextBusy || !pendingContext || !controller.active)return;
  const value=pendingContext;pendingContext=null;
  const context=extensions.modelContext;
  if(!context)return;
  contextBusy=true;
  try{
    await context.update(value,{timeout:5000});
  }catch{/* Optional context attachment cannot interrupt simulation. */}
  finally{contextBusy=false;if(controller.active && pendingContext)void publishSelection();}
}
function setOptions(select,items){
  select.replaceChildren(...items.map(item=>{const option=document.createElement('option');option.value=item.id;option.textContent=item.label || item.id;return option;}));
}
function cancelGesture(){
  const previous=gesture;gesture=null;
  if(previous)previous.control.dataset.pressed='false';
  if(previous?.kind==='pointer' && previous.control.hasPointerCapture?.(previous.id))previous.control.releasePointerCapture(previous.id);
  if(previous)controller.holdPolling(false);
}
function reloadNative(reason='reload'){
  if(!controller.canRecover || (controller.busy && !controller.backgroundRequest) || document.hidden)return false;
  cancelGesture();clearActionFeedback();stopMedia(reason);motion.cancel();drawError='';paintedKey='';
  // Use the supported worker restart, which creates a fresh session/result
  // lifetime. A semantic reset input can be declined by an authored app.
  controller.reload();return true;
}
function resetApp(control){
  if(!previewMode()){if(reloadNative('reset'))flashAction(control);return;}
  if(!readyForInput())return;
  cancelGesture();clearActionFeedback();stopMedia('reset');
  if(sendInput({type:'reset'}))flashAction(control);
}
function showMessage(){
  const message=drawError || controller.error || connectionError;
  $('message').textContent=message;$('message').hidden=!message;
}
function updateControls(){
  const state=controller.state;
  const ready=readyForInput();
  const connected=Boolean(state?.sessionId) && state.status!=='stopped' && controller.active;
  const primary=['button','touch'].includes(primaryKind());
  $('inputs').hidden=false;
  $('reset').hidden=!previewMode();
  $('key-legend').hidden=!primary;
  $('key-action').textContent=primaryKind()==='touch'?'Touch':'Button';
  const activeProfile=catalogProfiles().find(p=>p.id===(state?.profile||selectedProfile()?.id)) || {};
  const firstLabel=activeProfile.primaryLabel||'A',secondLabel=activeProfile.secondaryLabel||'B';
  $('device-primary').textContent=firstLabel;$('device-primary').setAttribute('aria-label','Press '+firstLabel);$('device-primary').title=firstLabel+' — press, hold and release';
  $('device-secondary').textContent=secondLabel;$('device-secondary').setAttribute('aria-label','Press '+secondLabel);$('device-secondary').title=secondLabel+' — app-controlled press/hold';
  $('device-secondary').hidden=!caps().secondaryButton;$('device-secondary').disabled=!ready||!caps().secondaryButton;
  $('device-primary').hidden=!['stickcplus2','sticks3'].includes(state?.sessionId?state.profile:selectedProfile()?.id);$('device-primary').disabled=!ready;
  const core=['cores3','cores3se'].includes(state?.sessionId?state.profile:selectedProfile()?.id);
  const se=(state?.sessionId?state.profile:selectedProfile()?.id)==='cores3se';
  $('device-touch-strip').hidden=!se;
  for(const control of stripControls){
    control.disabled=!se || !ready || !caps().touchStrip;
    control.title=caps().touchStrip?'Lower touch surface — app-defined touch region':'Lower touch surface — rebuild a compatible app to enable';
  }
  $('device-power').hidden=!core;$('device-rst').hidden=!core;$('power-hold').hidden=!core;
  $('device-power').disabled=!ready || !caps().powerButton;$('power-hold').disabled=!ready || !caps().powerButton;
  const resetReady=previewMode()?ready:controller.canRecover && (!controller.busy || controller.backgroundRequest) && !document.hidden;
  $('device-rst').disabled=!resetReady;
  $('device-power').title=caps().powerButton?'POWER — simulate BtnPWR.wasClicked(); no power switching':'POWER — rebuild the native app to enable BtnPWR events';
  $('shake').hidden=!caps().motion;$('shake').disabled=!ready || !caps().motion;
  $('motion').hidden=!caps().motion;
  document.querySelectorAll('[data-roll]').forEach(button=>{button.disabled=!ready || !caps().motion;});
  $('reset').disabled=!resetReady;
  $('reload').disabled=!controller.canRecover || (controller.busy && !controller.backgroundRequest);
  $('stop').disabled=!connected || controller.stopRequested;
  $('session-actions').hidden=previewMode();
  profilePicker.disabled=!catalogProfiles().length || controller.stopRequested || !controller.active || state?.status==='stopped';
  $('app').textContent=previewMode()?'Hello World (input preview)':state?.app || 'Waiting for app';
  if(primaryKind()==='touch' || (state?.sessionId?state.profile:selectedProfile()?.id)==='atoms3r'){
    bezel.setAttribute('role','button');bezel.setAttribute('tabindex',ready?'0':'-1');bezel.setAttribute('aria-label',primaryKind()==='touch'?'Tap the device display':'Press the AtomS3R display cap');bezel.setAttribute('aria-disabled',String(!ready));
    bezel.title=primaryKind()==='touch'?'Touch, hold and release':'Press, hold and release';
  }else{for(const name of ['role','tabindex','aria-label','aria-disabled'])bezel.removeAttribute(name);bezel.title='';}
  if(!ready)cancelGesture();
  const status=!controller.active?'Paused':controller.stopRequested?'Stopping':controller.busy && !controller.backgroundRequest?'Updating':
    controller.error || drawError?'Needs attention':connectionError?'Not connected':state?.status==='running'?'Running':state?.status==='stopped'?'Stopped':state?.status==='unavailable'?'Unavailable':state?.sessionId?'App stopped':'Input preview';
  $('status').textContent=status;$('status').dataset.state=controller.error || drawError || connectionError?'error':state?.status || 'waiting';
  $('status').hidden=status===$('display-mode').textContent;
  $('empty').hidden=Boolean(committed || previewPainted);$('display').hidden=!committed && !previewPainted;
  $('session-id').textContent=state?.sessionId || '—';$('build-id').textContent=committed?.buildId || '—';$('revision').textContent=committed?String(committed.revision):'—';
  if(state?.sessionId && !committed && previewPainted){
    $('display-note').hidden=false;$('display-note').textContent='Native display pending';
  }
  showMessage();
  updateMediaControls();
}
function render(){
  const key=JSON.stringify(controller.catalog || INPUT_PREVIEW_CATALOG);
  if(key!==catalogKey){catalogKey=key;setOptions(profilePicker,catalogProfiles());}
  syncMediaContext();
  if(controller.state?.status==='unavailable'){
    // A worker snapshot without a frame cannot inherit pixels or a pending
    // decode from its previous running state or the local illustration.
    decodeEpoch++;drawing=false;committed=null;paintedKey='';previewPainted=false;
    controller.holdPolling(false,'decode');
    $('display-note').hidden=true;$('preview-value').hidden=true;
    profilePicker.value=controller.state.profile;
  }
  if((controller.faulted || !controller.active || (!previewMode() && controller.state.status!=='running')) &&
     (liveMic?.state.armed || media.state.sound.enabled || media.state.sound.status==='enabling'))stopMedia('session-inactive');
  // Busy/poll notifications render the same snapshot. Only committed app
  // state can update demand; cached pixels must not undo a newer audio stop.
  if(controller.state!==microphoneRequestState){
    microphoneRequestState=controller.state;
    if(liveMic?.state.armed && controller.ready && !document.hidden)liveMic.setRequest(appRequestsMicrophone(),controller.state.revision);
  }
  if(gesture && gesture.sessionId!==inputSession())cancelGesture();
  if(previewMode()){
    profilePicker.value=selectedProfile()?.id || '';
    paintPreview();
  }
  const frame=controller.frame;
  const frameKey=frame?frame.sessionId+':'+frame.revision+':'+frame.sha256:'';
  if(frame && frameKey!==paintedKey && frame.sessionId===controller.state?.sessionId){
    paintedKey=frameKey;drawing=true;drawError='';void drawFrame(frame,{...controller.state});
  }
  if(!controller.busy && !drawing && committed){profilePicker.value=committed.profile;}
  updateControls();
}
async function drawFrame(frame,state){
  const epoch=++decodeEpoch;let image;
  controller.holdPolling(true,'decode');
  try{
    const bytes=Uint8Array.from(atob(frame.data),char=>char.charCodeAt(0));
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    const hash=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
    if(hash!==frame.sha256.toLowerCase())throw new Error('Display verification failed. Reload the app to recover.');
    image=await decodePNG(new Blob([bytes],{type:'image/png'}));
    if(image.width!==state.width || image.height!==state.height)throw new Error('Display dimensions do not match the selected device. Reload the app.');
    if(epoch!==decodeEpoch || !controller.active || state.sessionId!==controller.state?.sessionId || state.revision!==controller.state?.revision)return;
    if(canvas.width!==state.width)canvas.width=state.width;
    if(canvas.height!==state.height)canvas.height=state.height;
    const context=canvas.getContext('2d');if(!context)throw new Error('This host could not create a display canvas.');
    context.imageSmoothingEnabled=false;context.drawImage(image,0,0);
    // Native dimensions determine both bitmap and CSS ratio; no stretched frames.
    committed=state;profilePicker.value=state.profile;
    if(!controller.busy && !Object.keys(controller.desired).length){chosenProfile=state.profile;}
    const profile=catalogProfiles().find(item=>item.id===state.profile);
    setDeviceShape(profile || {...state,id:state.profile,label:state.profile});
    canvas.setAttribute('aria-label','Native device display');
    $('display-mode').textContent='Native app';$('display-mode').title='Native C++ framebuffer with simulated inputs.';$('display-note').hidden=true;$('preview-value').hidden=true;
    const roll=state.nativeState?.roll_degrees ?? state.rollDegrees;
    motion.setRoll(Number.isFinite(roll)?roll:0);
    $('roll').textContent=Number.isFinite(roll)?roll+'°':'—';
    document.querySelectorAll('[data-roll]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.roll)===roll)));
    attachSelection();
    consumeAppSound(state);
  }catch(error){if(epoch===decodeEpoch && controller.active){drawError=error.message || 'The display could not be decoded. Reload the app.';cancelGesture();stopMedia('display-error');}}
  finally{image?.close();if(epoch===decodeEpoch){drawing=false;if(!drawError)controller.holdPolling(false,'decode');updateControls();}}
}
async function decodePNG(blob){
  let timer,timedOut=false;
  const pending=createImageBitmap(blob).then(image=>{if(timedOut){image.close();throw new Error('Late display decode discarded.');}return image;});
  try{return await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>{timedOut=true;reject(new Error('Display decoding timed out. Reload the app to recover.'));},5000);})]);}
  finally{clearTimeout(timer);}
}
function usable(control){const profile=controller.state?.sessionId?controller.state.profile:selectedProfile()?.id;return readyForInput() &&
  ((control===bezel && (primaryKind()==='touch' || profile==='atoms3r')) || (control===$('device-primary') && ['stickcplus2','sticks3'].includes(profile)) ||
   (control===$('device-secondary') && caps().secondaryButton) ||
   (stripControls.includes(control) && profile==='cores3se' && caps().touchStrip));}
function controlPoint(control,x,y){
  if(stripControls.includes(control)){
    const point=motion.nativePoint($('device-touch-strip'),320,40,x,y);
    return point?{x:point.x,y:point.y+240}:null;
  }
  const dimensions=previewMode()?selectedProfile():controller.state;
  return control===bezel && primaryKind()==='touch'?motion.nativePoint(canvas,dimensions.width,dimensions.height,x,y):null;
}
function keyboardPoint(control){return stripControls.includes(control)?{x:Number(control.dataset.touchX ?? control.getAttribute('data-touch-x')),y:260}:null;}
function begin(control,kind,id,point){
  if(gesture || !usable(control))return;
  gesture={control,kind,id,point,sessionId:inputSession(),start:performance.now()};
  control.dataset.pressed='true';
  controller.holdPolling(true);
}
function finish(control,kind,id,endPoint=null){
  const saved=gesture;
  if(!saved || saved.control!==control || saved.kind!==kind || saved.id!==id)return;
  const valid=usable(control) && saved.sessionId===inputSession();
  gesture=null;
  control.dataset.pressed='false';
  if(kind==='pointer' && control.hasPointerCapture?.(id))control.releasePointerCapture(id);
  controller.holdPolling(false);
  suppressClickUntil=performance.now()+700;
  if(valid){const durationMs=pressDuration(saved.start,performance.now());if(control!==$('device-secondary') && durationMs>=1000 && !caps().spatialTouch)stopMedia('hold-reset');
    if(control===$('device-secondary'))sendInput({type:'secondary',durationMs});
    else if(caps().spatialTouch && saved.point && endPoint && Math.hypot(endPoint.x-saved.point.x,endPoint.y-saved.point.y)>=12)sendInput({type:'swipe',...saved.point,endX:endPoint.x,endY:endPoint.y,durationMs});
    else sendInput({type:'primary',durationMs,...(saved.point || {})});
  }
}
for(const control of primaryControls){
  control.addEventListener('pointerdown',event=>{
    if(event.button!==0 || !event.isPrimary || !usable(control))return;
    const point=controlPoint(control,event.clientX,event.clientY);
    if((control===bezel && primaryKind()==='touch' || stripControls.includes(control)) && !point)return;
    event.preventDefault();
    begin(control,'pointer',event.pointerId,point);
    if(gesture)control.setPointerCapture(event.pointerId);
  });
  control.addEventListener('pointerup',event=>{
    event.preventDefault();let point=null;
    if(caps().spatialTouch && (control===bezel || stripControls.includes(control)) && Number.isFinite(event.clientX)&&Number.isFinite(event.clientY)){
      point=controlPoint(control,event.clientX,event.clientY);
      if(!point){cancelGesture();return;}
    }
    finish(control,'pointer',event.pointerId,point);
  });
  control.addEventListener('pointercancel',cancelGesture);
  control.addEventListener('lostpointercapture',cancelGesture);
  control.addEventListener('click',event=>{
    event.preventDefault();
    if(performance.now()<suppressClickUntil || event.detail!==0 || !usable(control))return;
    // Assistive activation without a physical pointer/key sequence.
    if(sendInput({type:control===$('device-secondary')?'secondary':'primary',durationMs:50,...(keyboardPoint(control) || {})}))flashAction(control);
  });
}
document.addEventListener('keydown',event=>{
  if(event.repeat){if(gesture?.kind==='key' && gesture.id===event.key.toLowerCase())event.preventDefault();return;}
  if(event.ctrlKey || event.metaKey || event.altKey || document.hidden)return;
  if(event.target instanceof Element && event.target.closest('input,select,textarea,[contenteditable=true]'))return;
  const key=event.key.toLowerCase();
  const isPrimaryTarget=primaryControls.includes(event.target);
  const target=isPrimaryTarget && usable(event.target)?event.target:null;
  if(event.target instanceof Element && event.target.closest('button,a,summary') && !isPrimaryTarget)return;
  if(key==='b' && usable($('device-secondary'))){event.preventDefault();begin($('device-secondary'),'key',key,null);return;}
  if(!['a',' ','enter'].includes(key) || (key==='enter' && !target))return;
  const control=target || primaryControl();
  event.preventDefault();begin(control,'key',key,keyboardPoint(control));
});
document.addEventListener('keyup',event=>{
  const key=event.key.toLowerCase();if(gesture?.kind!=='key' || gesture.id!==key)return;
  event.preventDefault();finish(gesture.control,'key',key);
});
document.addEventListener('focusin',()=>{if(gesture?.kind==='key')cancelGesture();});
window.addEventListener('blur',()=>{cancelGesture();motion.cancel();});
profilePicker.addEventListener('change',()=>{
  cancelGesture();clearActionFeedback();stopMedia('profile-change');motion.reset();chosenProfile=profilePicker.value;
  if(controller.state?.sessionId)controller.select({profile:profilePicker.value});
  else{inputPreview=null;render();}
  attachSelection();
});
$('shake').addEventListener('click',()=>{if(sendInput({type:'shake'})){flashAction($('shake'));motion.shake();}});
$('reset').addEventListener('click',()=>resetApp($('reset')));
$('device-rst').addEventListener('click',()=>resetApp($('device-rst')));
for(const [id,action] of [['device-power','click'],['power-hold','hold']])$(id).addEventListener('click',()=>{
  if(!caps().powerButton)return;
  cancelGesture();if(sendInput({type:'power',action}))flashAction($(id));
});
document.querySelectorAll('[data-roll]').forEach(button=>button.addEventListener('click',()=>sendInput({type:'tilt',degrees:Number(button.dataset.roll)})));
$('reload').addEventListener('click',()=>reloadNative());
$('stop').addEventListener('click',()=>{cancelGesture();stopMedia('stop');motion.cancel();decodeEpoch++;drawing=false;controller.stop();});
$('sound-toggle').addEventListener('click',()=>{
  if(soundWanted && !media.state.sound.error){soundWanted=false;media.muteSound();}
  else if(readyForMedia() && caps().audioOutput!=='none'){soundWanted=true;void media.enableSound();}
  updateMediaControls();
});
$('sound-volume').addEventListener('input',()=>media.setVolume(Number($('sound-volume').value)/100));
document.addEventListener('visibilitychange',()=>{cancelGesture();motion.cancel();if(document.hidden)stopMedia('hidden');controller.setVisible(!document.hidden);});
const layoutObserver=typeof ResizeObserver==='function'?new ResizeObserver(sizeDevice):null;
layoutObserver?.observe($('stage'));
window.addEventListener('resize',sizeDevice);
function disposeView(){
  if(!controller.active)return;
  cancelGesture();clearActionFeedback();stopMedia('teardown');liveMic?.dispose();media.dispose();motion.dispose();layoutObserver?.disconnect();decodeEpoch++;pendingContext=null;controller.dispose();
}
window.addEventListener('pagehide',disposeView);

function applyContext(context){
  if(context?.theme)applyDocumentTheme(context.theme);
  if(context?.styles?.variables)applyHostStyleVariables(context.styles.variables);
}
function refreshHostMediaSupport(){
  let hostCapabilities;
  try{hostCapabilities=app.getHostCapabilities?.();}catch{/* Unreported capabilities remain unknown. */}
  hostMediaSupport=readHostMediaSupport({hostCapabilities,document,navigator:window.navigator,
    AudioContext:window.AudioContext??window.webkitAudioContext,AudioWorkletNode:window.AudioWorkletNode,isSecureContext:window.isSecureContext});
  updateMediaControls();
}
// Must be installed before connect: the initial opener result is authoritative.
app.ontoolresult=result=>{
  if(!controller.active)return;
  if(!result?.isError && result?.structuredContent?.status==='welcome' && !result.structuredContent.sessionId){
    cancelGesture();stopMedia('welcome');motion.reset();decodeEpoch++;drawing=false;drawError='';committed=null;paintedKey='';inputPreview=null;
    chosenProfile=result.structuredContent.profile || null;
    controller.holdPolling(false,'decode');
  }
  controller.receive(result);
  if(!result?.isError)attachSelection();
};
app.onhostcontextchanged=context=>{applyContext(context);if(hostConnected)refreshHostMediaSupport();};
app.onteardown=()=>{disposeView();return {};};
render();
try{
  await app.connect();
  hostConnected=true;
  refreshHostMediaSupport();
  render();
  // Publish the selected simulation once per connected view, never on frame renders.
  attachSelection();
  const context=app.getHostContext();applyContext(context);
  if(context?.displayMode!=='fullscreen' && context?.availableDisplayModes?.includes('fullscreen')){
    // One request only. The host's returned mode is accepted without retries.
    await app.requestDisplayMode({mode:'fullscreen'}).catch(()=>{});
  }
  // An opener with no workspace provides the catalog. Never invoke it again.
}catch(error){connectionError='Host connection unavailable. '+(error.message || '');updateControls();}
