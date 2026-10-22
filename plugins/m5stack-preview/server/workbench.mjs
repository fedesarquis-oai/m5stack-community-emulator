import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NativeSession } from './native-session.mjs';
import { randomUUID } from 'node:crypto';
import { loadWorkspaceImage } from './raster-image.mjs';

const moduleDirectory=path.dirname(fileURLToPath(import.meta.url));
export const PLUGIN_ROOT = path.resolve(moduleDirectory,path.basename(moduleDirectory)==='dist'?'../..':'..');
export {DEVICE_PROFILES as PROFILES} from '../ui/device-profiles.mjs';
import {DEVICE_PROFILES as PROFILES} from '../ui/device-profiles.mjs';
export const APPS = Object.freeze([
  { id:'counter', label:'Hello World', example:true },
  { id:'custom', label:'My device app', example:false },
]);
export function chooseProfile(value='atoms3r') {
  if (!PROFILES.some(p=>p.id===value)) throw new Error('Unsupported simulation profile. Choose AtomS3R C126, M5StickC Plus2, StickS3 K150, standard CoreS3 or CoreS3 SE.');
  return value;
}
export function chooseApp(value='counter') {
  if (!APPS.some(p=>p.id===value)) throw new Error('Unsupported app. Choose an app from this workspace catalog.');
  return value;
}
export function catalog() {
  return { version:'0.7.42', profiles:PROFILES, apps:APPS,
    fidelity:'Native C++ framebuffer preview. Physical peripherals, firmware and electrical behavior are not emulated.',
    hardwareAccess:false };
}
function textResult(value, frame) {
  return { content:[{type:'text',text:JSON.stringify(value)}], structuredContent:value,
    ...(frame ? {_meta:{frame:{mimeType:frame.mimeType,data:frame.png.toString('base64'),sha256:frame.sha256,
      rgbSha256:frame.rgbSha256,width:frame.width,height:frame.height}}} : {}) };
}
export function present(snapshot) {
  const {frame,nativeState,...metadata}=snapshot;
  // Native application strings are data. Keep them out of instruction text/HTML.
  const packet=nativeState?.speaker_output;
  const safeState=packet?{...nativeState,speaker_output:{...packet,pcm_s16le:undefined}}:nativeState;
  const result=textResult({...metadata,nativeState:safeState,rollDegrees:nativeState?.roll_degrees??0,catalog:catalog()}, frame);
  if(packet)result._meta={...result._meta,speakerPcm:packet};
  return result;
}
export async function workspacePath(input) {
  if (typeof input!=='string' || !path.isAbsolute(input)) throw new Error('Select an absolute local workspace path in chat.');
  const root=await fs.realpath(input);
  const inside=path.relative(PLUGIN_ROOT,root);
  if (!inside || (!inside.startsWith('..'+path.sep) && inside!=='..' && !path.isAbsolute(inside))) throw new Error('Create an editable workspace outside the installed plugin.');
  for (const name of ['m5preview','dependencies.lock.json','src/virtual_device.cpp']) {
    const item=path.join(root,name), st=await fs.lstat(item);
    if (!st.isFile() || st.isSymbolicLink()) throw new Error('The selected directory is not a prepared M5Stack workspace.');
    const actual=await fs.realpath(item), relative=path.relative(root,actual);
    if (relative.startsWith('..'+path.sep) || path.isAbsolute(relative)) throw new Error('Workspace resources must remain inside the selected directory.');
  }
  return root;
}

export class Workbench {
  constructor({openNative=options=>NativeSession.open(options), lifetimeMs=30*60*1000, maxSessions=3}={}) {
    this.openNative=openNative; this.lifetimeMs=lifetimeMs; this.maxSessions=maxSessions;
    this.sessions=new Map(); this.queues=new Map(); this.stoppedSessions=new Map(); this.operations=new Set(); this.pendingOpen=0; this.closed=false;this.observers=new Set();
  }
  observe(listener){this.observers.add(listener);return ()=>this.observers.delete(listener);}
  notify(snapshot){for(const listener of this.observers)try{listener(snapshot);}catch{}}
  publish(native){const snapshot=native.snapshot();this.notify(snapshot);return present(snapshot);}
  track(operation){
    this.operations.add(operation);
    operation.then(()=>this.operations.delete(operation),()=>this.operations.delete(operation));
    return operation;
  }
  open(args={}){return this.track(this.openSession(args));}
  async openSession({workspace,profile='atoms3r',app='counter'}={}) {
    chooseProfile(profile); chooseApp(app);
    if (this.closed) throw new Error('Workbench is stopping.');
    if (!workspace) {
      const selected=PROFILES.find(item=>item.id===profile);
      return textResult({status:'welcome',mode:'input-preview',sessionId:null,profile,app:'counter',requestedApp:app,
        width:selected.width,height:selected.height,
        capabilities:{primaryInput:selected.primaryInput,powerButton:selected.powerButton===true,motion:selected.motion,microphone:selected.microphone,
          microphoneMode:selected.microphone?'level':'none',microphoneMapping:'illustrative',
          audioOutput:selected.audioOutput,audioMode:selected.audioOutput==='none'?'none':'tone',mediaAdapter:0},
        catalog:catalog()});
    }
    const root=await workspacePath(workspace);
    if (this.sessions.size+this.pendingOpen>=this.maxSessions) throw new Error('Stop an existing preview before opening another workspace.');
    this.pendingOpen++;
    let native;
    try {
      native=await this.openNative({workspaceRoot:root,profileId:profile,appId:app});
      if (this.closed) {await native.close(); throw new Error('Workbench stopped while opening.');}
      const record={native,root,expiresAt:Date.now()+this.lifetimeMs,stopped:false,timer:null};
      record.timer=setTimeout(()=>this.stop({sessionId:record.native.sessionId}).catch(()=>{}),this.lifetimeMs);
      record.timer.unref?.();
      this.sessions.set(native.sessionId,record);
      return this.publish(native);
    } finally {this.pendingOpen--;}
  }
  record(sessionId) {
    const entry=this.sessions.get(sessionId);
    if (!entry || entry.stopped || entry.native.sessionId!==sessionId) throw new Error('This preview session was stopped or replaced. Open the current workspace preview again.');
    if (Date.now()>=entry.expiresAt) throw new Error('This preview expired. Open a new bounded session.');
    return entry;
  }
  async ordered(sessionId, action) {
    // The record, not a replaceable session ID, owns the queue.
    const entry=this.record(sessionId);
    if((entry.queued??0)>=8)throw new Error('Too many queued preview operations. Wait for the current actions to finish.');
    entry.queued=(entry.queued??0)+1;
    const before=this.queues.get(entry)||Promise.resolve();
    const task=this.track(before.catch(()=>{}).then(()=>{this.record(sessionId); return action(entry);}));
    this.queues.set(entry,task);
    try {return await task;} finally {entry.queued--;if(this.queues.get(entry)===task)this.queues.delete(entry);}
  }
  frame({sessionId}) {
    if(this.stoppedSessions.has(sessionId))return Promise.resolve(textResult({sessionId,status:'stopped'}));
    const entry=this.sessions.get(sessionId);
    if(entry?.cleanupError)return Promise.resolve(present({...entry.native.snapshot(),status:'unavailable',
      renderer:{status:'unavailable',message:entry.cleanupError,exitCode:null}}));
    return this.ordered(sessionId,async entry=>{
    try {await entry.native.refresh();} catch(error) {
      const snapshot=entry.native.snapshot();
      if(snapshot.status==='running')throw error;
      this.notify(snapshot);return present(snapshot);
    }
    return this.publish(entry.native);
  });}
  input({sessionId,requestId,event}) {
    return this.ordered(sessionId,async entry=>{await entry.native.input({sessionId,requestId,event}); return this.publish(entry.native);});
  }
  audio(args) {
    let entry;
    try {
      entry=this.record(args?.sessionId);
      if(entry.audioBusy)throw new Error('Only one microphone operation may be outstanding.');
      if(typeof entry.native.audio!=='function')throw new Error('This native adapter does not accept PCM microphone input.');
    }catch{return Promise.resolve({isError:true,content:[{type:'text',text:'Microphone operation is unavailable for this session.'}]});}
    entry.audioBusy=true;
    // Audio has its own single-operation bound; NativeSession serializes the
    // underlying pipe without making every PCM chunk render a framebuffer.
    return this.track(Promise.resolve().then(async()=>{
      this.record(args.sessionId);
      const ack=await entry.native.audio(args);
      return {content:[{type:'text',text:'Microphone operation acknowledged.'}],structuredContent:ack};
    }).catch(error=>({isError:true,content:[{type:'text',text:'Microphone operation rejected.'}],
      structuredContent:{errorCode:typeof error?.code==='string'&&/^[A-Z_]{1,40}$/.test(error.code)?error.code:'AUDIO_FAILED'}}))
      .finally(()=>{entry.audioBusy=false;}));
  }
  setText({sessionId,text,context}) {
    return this.input({sessionId,requestId:'text_'+randomUUID(),event:{type:'text',text,...(context?{context}:{})}});
  }
  importImage({sessionId,relativePath,fit='contain',context}) {
    return this.ordered(sessionId,async entry=>{
      const snapshot=entry.native.snapshot();
      if(!snapshot.capabilities.imageInput)throw new Error('This app needs the current image adapter before importing.');
      const image=await loadWorkspaceImage(entry.root,relativePath,{width:snapshot.width,height:snapshot.height,fit,background:0});
      this.record(sessionId);
      await entry.native.input({sessionId,requestId:'image_'+randomUUID(),event:{type:'image',id:'img_'+image.sourceSha256.slice(0,32),width:image.width,height:image.height,pixelsBase64:image.rgb565.toString('base64'),...(context?{context}:{})}});
      return this.publish(entry.native);
    });
  }
  select({sessionId,profile,app}) {
    return this.ordered(sessionId,async entry=>{
      const nextProfile=chooseProfile(profile??entry.native.profileId),nextApp=chooseApp(app??entry.native.appId);
      if(nextProfile===entry.native.profileId && nextApp===entry.native.appId)return present(entry.native.snapshot());
      return this.replace(entry,sessionId,nextProfile,nextApp);
    });
  }
  reload({sessionId}) {return this.ordered(sessionId,entry=>this.replace(entry,sessionId,entry.native.profileId,entry.native.appId));}
  async replace(entry,oldId,profile,app) {
    const next=await this.openNative({workspaceRoot:entry.root,profileId:profile,appId:app});
    if(entry.stopped || this.closed || Date.now()>=entry.expiresAt) {await next.close(); throw new Error('Preview stopped during selection.');}
    const previous=entry.native;
    try {await previous.close();} catch(error) {
      await next.close();
      throw new Error('The previous worker did not confirm cleanup. Replacement cancelled; no new session was published. '+error.message);
    }
    if(entry.stopped || this.closed || Date.now()>=entry.expiresAt) {await next.close(); throw new Error('Preview stopped during selection.');}
    entry.native=next;
    this.sessions.delete(oldId); this.rememberStopped(oldId); this.sessions.set(next.sessionId,entry);
    this.notify({sessionId:oldId,status:'stopped'});return this.publish(next);
  }
  stop(args){return this.track(this.stopSession(args));}
  async stopSession({sessionId}) {
    const entry=this.sessions.get(sessionId);
    if(!entry){
      if(this.stoppedSessions.has(sessionId))return textResult({sessionId,status:'stopped'});
      throw new Error('This preview session is unknown; no process was stopped.');
    }
    entry.stopped=true; clearTimeout(entry.timer);this.notify({sessionId,status:'stopped'});
    try {await entry.native.close();} catch(error) {
      entry.cleanupError='Native worker cleanup was not confirmed. '+error.message;
      throw new Error(entry.cleanupError);
    }
    this.sessions.delete(sessionId);this.rememberStopped(sessionId);
    return textResult({sessionId,status:'stopped'});
  }
  rememberStopped(id){
    this.stoppedSessions.set(id,true);
    while(this.stoppedSessions.size>64)this.stoppedSessions.delete(this.stoppedSessions.keys().next().value);
  }
  async close() {
    this.closed=true;
    await Promise.allSettled([...this.sessions.keys()].map(sessionId=>this.stop({sessionId})));
    await Promise.allSettled([...this.operations]);
    await Promise.allSettled([...this.sessions.keys()].map(sessionId=>this.stop({sessionId})));
    if([...this.sessions.values()].some(entry=>entry.cleanupError))throw new Error('One or more native worker exits were not confirmed.');
  }
}

async function executable(name) {
  for(const part of (process.env.PATH||'').split(path.delimiter)) {
    if(!part || !path.isAbsolute(part)) continue;
    const value=path.join(part,name);
    try {await fs.access(value,1); if((await fs.stat(value)).isFile())return value;} catch {}
  }
  return null;
}
export async function doctor({workspace}={}) {
  const tools=Object.fromEntries(await Promise.all(['python3','git','clang','clang++'].map(async name=>[name,await executable(name)])));
  let prepared=false,dependencies=false;
  if(workspace) {
    const root=await workspacePath(workspace); prepared=true;
    try {const lock=JSON.parse(await fs.readFile(path.join(root,'dependencies.lock.json'),'utf8'));
      const names=Array.isArray(lock)?lock.map(x=>x.name):Object.keys(lock.dependencies??lock);
      dependencies=names.length>0 && (await Promise.all(names.map(name=>fs.stat(path.join(root,'vendor',name)).then(s=>s.isDirectory()).catch(()=>false)))).every(Boolean);
    } catch {}
  }
  return textResult({node:process.versions.node,platform:process.platform,architecture:process.arch,tools,
    workspacePrepared:prepared,dependencyDirectoriesPresent:dependencies,
    note:'Tool paths and directory presence do not verify a usable SDK or dependency pins. Build verifies pins. Setup uses approved Git access; do not retry blocked executables.',hardwareAccess:false});
}

const builds=new Map();
let buildsStopping=false;
export async function build({workspace,profile}) {
  chooseProfile(profile); const root=await workspacePath(workspace);
  if(buildsStopping)throw new Error('Workbench is stopping.');
  if(builds.has(root))throw new Error('A build is already running for this workspace.');
  const record={child:null}; builds.set(root,record);
  try {
    const python=await executable('python3');
    if(buildsStopping)throw new Error('Workbench is stopping.');
    if(!python)throw new Error('Approved Python 3.9+ is required. Use the company-approved setup process; no runtime installer is included.');
    const output=await boundedBuild(python,[path.join(root,'m5preview'),'web-build','--profile',profile],root,record);
    return textResult({status:'built',profile,output,hardwareAccess:false,next:'Reload the open workbench to use the new build.'});
  } finally {builds.delete(root);}
}
export async function stopBuilds() {
  buildsStopping=true;
  const results=await Promise.allSettled([...builds.values()].map(record=>record.stop?.()));
  if(results.some(result=>result.status==='rejected'))throw new Error('Native build cleanup was not confirmed.');
}
function boundedBuild(command,args,cwd,record) {
  let finishStopped;
  const stopped=new Promise(resolve=>{finishStopped=resolve;});
  const result=new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
    record.child=child;
    let output='',finished=false,timer,killTimer,finalTimer,stopReason='',cleanupUnconfirmed=false;
    const append=chunk=>{output=(output+chunk.toString()).slice(-16000);};
    child.stdout.on('data',append);child.stderr.on('data',append);
    const finish=(error)=>{
      if(finished)return;finished=true;clearTimeout(timer);clearTimeout(killTimer);clearTimeout(finalTimer);
      finishStopped();error?reject(error):resolve(output);
    };
    const stop=(reason='cancelled')=>{
      if(finished || stopReason)return;
      stopReason=reason;
      try {process.platform==='win32'?child.kill('SIGTERM'):process.kill(-child.pid,'SIGTERM');}catch{}
      killTimer=setTimeout(()=>{try{process.platform==='win32'?child.kill('SIGKILL'):process.kill(-child.pid,'SIGKILL');}catch{}},1000);
      finalTimer=setTimeout(()=>{
        cleanupUnconfirmed=true;
        child.stdout.destroy();child.stderr.destroy();
        finish(new Error('Native build cleanup deadline reached; no successful build is claimed.'));
      },2000);
    };
    record.stop=async()=>{stop();await stopped;if(cleanupUnconfirmed)throw new Error('Native build cleanup was not confirmed.');};
    timer=setTimeout(()=>stop('timed out'),300000);timer.unref?.();
    child.once('error',error=>finish(new Error('Build process could not start: '+error.message)));
    child.once('close',code=>finish(code===0 && !stopReason?null:new Error('Native build failed or was '+(stopReason||'interrupted')+'. Inspect the workspace build log; do not retry a company-blocked executable. '+output)));
  });
  result.catch(()=>{});
  return result;
}
