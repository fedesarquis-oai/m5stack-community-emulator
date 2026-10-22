import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workbench,workspacePath,catalog,PLUGIN_ROOT} from './workbench.mjs';

let next=0;
function fakeNative(options){
  const native={sessionId:'test-'+(++next),profileId:options.profileId,appId:options.appId,buildId:'fixture',closed:false,revision:1,
    snapshot(){return {sessionId:this.sessionId,profile:this.profileId,app:this.appId,status:this.closed?'stopped':'running',revision:this.revision,width:128,height:128,buildId:this.buildId,capabilities:{},frame:null};},
    async refresh(){this.revision++;},async input(){this.revision++;},async close(){this.closed=true;}};
  return native;
}
async function prepared(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'m5stack-manager-'));
  await fs.mkdir(path.join(root,'src'));await fs.writeFile(path.join(root,'m5preview'),'fixture');
  await fs.writeFile(path.join(root,'dependencies.lock.json'),'{}');await fs.writeFile(path.join(root,'src/virtual_device.cpp'),'fixture');return root;
}
test('welcome opens without running a native program',async()=>{
  let opened=0;const manager=new Workbench({openNative:async()=>{opened++;}});
  const state=(await manager.open()).structuredContent;
  assert.equal(state.status,'welcome');assert.equal(state.mode,'input-preview');assert.equal(state.sessionId,null);
  assert.equal(state.profile,'atoms3r');assert.equal(state.app,'counter');assert.equal(state.width,128);assert.equal(state.height,128);
  assert.equal(state.capabilities.primaryInput,'button');assert.equal(state.capabilities.microphone,false);
  assert.equal(state.catalog.apps[0].label,'Hello World');assert.equal(opened,0);await manager.close();
});
test('workspace-free welcome preserves exact device selection and supported controls',async()=>{
  let opened=0;const manager=new Workbench({openNative:async()=>{opened++;}});
  for(const profile of catalog().profiles){
    const state=(await manager.open({profile:profile.id})).structuredContent;
    assert.equal(state.profile,profile.id);assert.equal(state.width,profile.width);assert.equal(state.height,profile.height);
    assert.equal(state.capabilities.primaryInput,profile.primaryInput);assert.equal(state.capabilities.motion,profile.motion);
    assert.equal(state.capabilities.microphone,profile.id!=='atoms3r');assert.equal(state.capabilities.audioOutput,{atoms3r:'none',stickcplus2:'buzzer',sticks3:'speaker',cores3:'speaker',cores3se:'speaker'}[profile.id]);assert.equal(state.sessionId,null);
  }
  await assert.rejects(manager.open({profile:'stick-s3'}),/Unsupported/);
  const withoutProject=(await manager.open({profile:'cores3',app:'custom'})).structuredContent;
  assert.equal(withoutProject.app,'counter');assert.equal(withoutProject.requestedApp,'custom');
  assert.equal(opened,0);await manager.close();
});
test('explicit profile knowledge never aliases unsupported devices',()=>{
  assert.deepEqual(catalog().profiles.map(x=>x.id),['atoms3r','stickcplus2','sticks3','cores3','cores3se']);
  assert.deepEqual(catalog().profiles.map(p=>[p.id,p.microphone,p.audioOutput]),[
    ['atoms3r',false,'none'],['stickcplus2',true,'buzzer'],['sticks3',true,'speaker'],['cores3',true,'speaker'],['cores3se',true,'speaker']
  ]);
  const se=catalog().profiles.find(profile=>profile.id==='cores3se');assert.equal(se.motion,false);assert.equal(se.hardware.camera,false);assert.equal(se.hardware.includedBattery,false);assert.deepEqual(se.hardware.touchSurface,{width:320,height:280});assert.deepEqual(se.touchBounds,{x:0,y:0,width:320,height:280});assert.equal(se.touchPolicy,'worker-gated-full-surface');assert.equal(se.requiredTouchStripAdapter,1);
});
test('open results contain simulation state without onboarding state',async()=>{
  const root=await prepared();const manager=new Workbench({openNative:async options=>fakeNative(options)});
  try{
    const welcome=(await manager.open()).structuredContent;
    assert.equal(welcome.mode,'input-preview');assert.equal(welcome.sessionId,null);
    const native=(await manager.open({workspace:root})).structuredContent;
    const reload=(await manager.reload({sessionId:native.sessionId})).structuredContent;
    for(const state of [welcome,native,reload])for(const key of ['onboarding','guideStep','guideDismissed'])assert.equal(Object.hasOwn(state,key),false);
    assert.equal(native.status,'running');assert.equal(reload.status,'running');
  }finally{await manager.close();await fs.rm(root,{recursive:true,force:true});}
});
test('workspace refuses package/cache and linked launcher',async()=>{
  await assert.rejects(workspacePath(path.join(PLUGIN_ROOT,'runtime')),/outside/);
  const root=await prepared();try{await fs.unlink(path.join(root,'m5preview'));await fs.symlink('/bin/sh',path.join(root,'m5preview'));await assert.rejects(workspacePath(root),/prepared/);}finally{await fs.rm(root,{recursive:true,force:true});}
});
test('failed selection preserves live session; successful replacement reaps old and rejects late input',async()=>{
  const root=await prepared(),opened=[];
  const manager=new Workbench({openNative:async options=>{if(options.profileId==='cores3')throw Error('not built');const n=fakeNative(options);opened.push(n);return n;}});
  try{
    const first=(await manager.open({workspace:root})).structuredContent.sessionId;
    await assert.rejects(manager.select({sessionId:first,profile:'cores3'}),/not built/);assert.equal(opened[0].closed,false);
    const second=(await manager.select({sessionId:first,app:'custom'})).structuredContent.sessionId;
    assert.notEqual(second,first);assert.equal(opened[0].closed,true);
    await assert.rejects(manager.input({sessionId:first,requestId:'stale',event:{type:'shake'}}),/replaced/);
    await manager.stop({sessionId:second});assert.equal(opened[1].closed,true);
    assert.equal((await manager.frame({sessionId:second})).structuredContent.status,'stopped');
    assert.equal((await manager.frame({sessionId:first})).structuredContent.status,'stopped');
  }finally{await manager.close();await fs.rm(root,{recursive:true,force:true});}
});
test('stop during slow selection closes both owned workers and never revives the view',async()=>{
  const root=await prepared(),opened=[];let resume;
  const manager=new Workbench({openNative:async options=>{const n=fakeNative(options);opened.push(n);if(opened.length===2)await new Promise(resolve=>{resume=resolve;});return n;}});
  try{
    const first=(await manager.open({workspace:root})).structuredContent.sessionId;
    const changing=manager.select({sessionId:first,app:'custom'});
    while(!resume)await new Promise(resolve=>setImmediate(resolve));
    await manager.stop({sessionId:first});resume();await assert.rejects(changing,/stopped/);
    assert.ok(opened.every(n=>n.closed));assert.equal(manager.sessions.size,0);
  }finally{await manager.close();await fs.rm(root,{recursive:true,force:true});}
});
test('owned preview limit includes concurrent pending opens',async()=>{
  const root=await prepared();let resume;
  const manager=new Workbench({maxSessions:1,openNative:async options=>{await new Promise(resolve=>{resume=resolve;});return fakeNative(options);}});
  try{const pending=manager.open({workspace:root});while(!resume)await new Promise(resolve=>setImmediate(resolve));await assert.rejects(manager.open({workspace:root}),/Stop an existing/);resume();await pending;}finally{await manager.close();await fs.rm(root,{recursive:true,force:true});}
});
test('renderer failure returns last frame health and allows explicit replacement',async()=>{
  const root=await prepared();const manager=new Workbench({openNative:async options=>{
    const n=fakeNative(options);const snapshot=n.snapshot.bind(n);n.snapshot=()=>({...snapshot(),status:n.failed?'unavailable':'running'});
    n.refresh=async()=>{n.failed=true;throw Error('native failed');};return n;}});
  try{const sid=(await manager.open({workspace:root})).structuredContent.sessionId;const result=await manager.frame({sessionId:sid});assert.equal(result.structuredContent.status,'unavailable');const replaced=await manager.reload({sessionId:sid});assert.equal(replaced.structuredContent.status,'running');}finally{await manager.close();await fs.rm(root,{recursive:true,force:true});}
});
test('PCM acknowledgments remain lightweight, redacted and independent of frame observers',async()=>{
  const root=await prepared();let native,release,entered;
  const manager=new Workbench({openNative:async options=>native=fakeNative(options)});
  try{
    const sid=(await manager.open({workspace:root,profile:'cores3se'})).structuredContent.sessionId;let notifications=0;manager.observe(()=>notifications++);
    native.audio=async args=>({sessionId:sid,streamId:args.streamId,action:args.action,accepted:true,sequence:-1,nextFrame:0,requested:true,active:true});
    const ack=await manager.audio({sessionId:sid,streamId:'stream',action:'start',source:'browser'});assert.equal(ack.structuredContent.accepted,true);assert.equal('_meta'in ack,false);assert.equal(notifications,0);
    const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
    native.audio=async()=>{entered();await gate;throw Object.assign(new Error('PRIVATE_PCM_PAYLOAD'),{code:'AUDIO_ORDER'});};
    const first=manager.audio({sessionId:sid,streamId:'stream',action:'chunk',pcmBase64:'PRIVATE_PCM_PAYLOAD'});await started;
    assert.equal((await manager.audio({sessionId:sid})).isError,true);
    assert.equal((await manager.frame({sessionId:sid})).structuredContent.status,'running');
    release();const error=await first;assert.equal(error.isError,true);assert.equal(error.structuredContent.errorCode,'AUDIO_ORDER');assert.equal(JSON.stringify(error).includes('PRIVATE_PCM_PAYLOAD'),false);
    await manager.stop({sessionId:sid});assert.equal((await manager.audio({sessionId:sid,action:'stop'})).isError,true);
  }finally{release?.();await manager.close();await fs.rm(root,{recursive:true,force:true});}
});
