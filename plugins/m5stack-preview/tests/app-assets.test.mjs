import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {NativeSession,encodeNativePng} from '../server/native-session.mjs';
import {Workbench} from '../server/workbench.mjs';
import {decodePng} from '../server/raster-image.mjs';
const root=process.env.M5_APP_REVIEW_WORKSPACE,fixture=process.env.M5_APP_REVIEW_FIXTURE;
const opts={skip:!root};
async function open(t,workspace=root){const s=await NativeSession.open({workspaceRoot:workspace,profileId:'cores3se',appId:'custom'});t.after(()=>s.close());return s;}
const send=(s,id,event)=>s.input({sessionId:s.sessionId,requestId:id,event});
const record=id=>({id,mime_type:'audio/wav',duration_ms:2000,bytes:64044,sha256:'a'.repeat(64),source:'fixture'});
const textContext={draftId:'draft_fixture',requestId:'request_text',revision:1};
const imageContext={draftId:'draft_fixture',requestId:'request_image',revision:2};
test('SE native exposes only exact capabilities and rejects missing or excess image bytes',opts,async t=>{
 const s=await open(t),cap=s.snapshot().capabilities;assert.equal(cap.motion,false);assert.equal(cap.spatialTouch,true);assert.equal(cap.recordingInput,true);assert.equal(cap.imageInput,true);
 for(const event of [{type:'shake'},{type:'tilt',degrees:0},{type:'primary',x:10,y:280,durationMs:50},{type:'image',id:'x',width:320,height:240,pixelsBase64:'AAAA'}])await assert.rejects(send(s,'invalid_'+Math.random().toString(36).slice(2),event));
 assert.equal(s.snapshot().status,'running');
});
test('recording ready needs current capture ID/source and duplicate transport retry is idempotent',opts,async t=>{
 const s=await open(t),value=record('clip_1');
 await assert.rejects(send(s,'early',{type:'recording',recording:value}),{code:'STALE_RECORDING'});
 await send(s,'request',{type:'recording_request',id:value.id,source:'fixture'});
 await send(s,'start',{type:'recording_start',id:value.id,source:'fixture'});
 await assert.rejects(send(s,'before_stop',{type:'recording',recording:value}),{code:'STALE_RECORDING'});
 await send(s,'stopped',{type:'recording_stopped',id:value.id,source:'fixture'});
 const ready=await send(s,'ready',{type:'recording',recording:value});assert.equal(ready.nativeState.recording.id,value.id);assert.equal(ready.nativeState.recording_capture,null);
 const duplicate=await send(s,'ready',{type:'recording',recording:value});assert.equal(duplicate.revision,ready.revision);
 await assert.rejects(send(s,'new_ready',{type:'recording',recording:value}),{code:'STALE_RECORDING'});
 await send(s,'clear',{type:'recording_clear'});assert.equal(s.snapshot().nativeState.recording,null);
});
test('queued reset invalidates a previously valid recording completion without terminating worker',opts,async t=>{
 const s=await open(t),value=record('queued_clip');await send(s,'request',{type:'recording_request',id:value.id,source:'fixture'});await send(s,'start',{type:'recording_start',id:value.id,source:'fixture'});await send(s,'stopped',{type:'recording_stopped',id:value.id,source:'fixture'});
 const reset=send(s,'reset',{type:'reset'}),late=send(s,'late',{type:'recording',recording:value});const observed=assert.rejects(late,{code:'STALE_RECORDING'});await reset;await observed;assert.equal(s.snapshot().status,'running');
});
test('spatial tap and swipe preserve independent counter semantics',opts,async t=>{
 const s=await open(t);await send(s,'tap',{type:'primary',x:20,y:25,durationMs:50});assert.equal(s.snapshot().nativeState.count,1);
 await send(s,'swipe',{type:'swipe',x:300,y:80,endX:20,endY:80,durationMs:450});assert.equal(s.snapshot().nativeState.count,1);
 await send(s,'hold',{type:'primary',x:20,y:25,durationMs:1200});assert.equal(s.snapshot().nativeState.count,0);
});
test('correlated text consumes before app arms image request, and repeated request ID remains idempotent',{skip:!fixture},async t=>{
 const s=await open(t,fixture);await send(s,'arm',{type:'primary',x:20,y:20,durationMs:50});
 assert.deepEqual(s.snapshot().nativeState.expected_result,{draft_id:'draft_fixture',request_id:'request_text',revision:1});
 await assert.rejects(send(s,'wrong',{type:'text',text:'fixture',context:{...textContext,revision:2}}),{code:'STALE_RESULT'});
 const text={type:'text',text:'A deterministic voice-text fixture.',context:textContext},result=await send(s,'text_result',text);
 assert.deepEqual(result.nativeState.expected_result,{draft_id:'draft_fixture',request_id:'request_image',revision:2});
 assert.equal((await send(s,'text_result',text)).revision,result.revision);
 await assert.rejects(send(s,'text_replay',text),{code:'STALE_RESULT'});
 assert.equal(s.snapshot().status,'running');
});
test('queued reset rejects stale text before native pipe write',{skip:!fixture},async t=>{
 const s=await open(t,fixture);await send(s,'arm',{type:'primary',x:20,y:20,durationMs:50});
 const reset=send(s,'reset',{type:'reset'}),late=send(s,'late',{type:'text',text:'late',context:textContext});
 const rejection=assert.rejects(late,{code:'STALE_RESULT'});await reset;await rejection;assert.equal(s.snapshot().status,'running');assert.equal(s.snapshot().nativeState.expected_result,null);
});
test('named PNG and correlated image produce real RGB565 native framebuffer corners',{skip:!fixture},async t=>{
 const fixtures=path.join(fixture,'media-fixtures');await fs.mkdir(fixtures,{recursive:true});
 await fs.writeFile(path.join(fixtures,'review_swatch.png'),encodeNativePng(Buffer.from([255,0,0,0,255,0,0,0,255,255,255,255]),2,2));
 const manager=new Workbench();t.after(()=>manager.close());const opened=await manager.open({workspace:fixture,profile:'cores3se',app:'custom'}),sid=opened.structuredContent.sessionId;
 await manager.input({sessionId:sid,requestId:'arm',event:{type:'primary',x:20,y:20,durationMs:50}});
 await manager.setText({sessionId:sid,text:'Text fixture',context:textContext});
 await assert.rejects(manager.importImage({sessionId:sid,relativePath:'../private.png',context:imageContext}));
 const result=await manager.importImage({sessionId:sid,relativePath:'media-fixtures/review_swatch.png',fit:'cover',context:imageContext});
 assert.equal(result.structuredContent.nativeState.expected_result,null);assert.equal(result.structuredContent.nativeState.image.width,320);
 const png=Buffer.from(result._meta.frame.data,'base64'),decoded=decodePng(png),p=decoded.rgba;
 assert.deepEqual([...p.subarray(0,4)],[255,0,0,255]);assert.deepEqual([...p.subarray((319)*4,(319)*4+4)],[0,255,0,255]);
 assert.deepEqual([...p.subarray(239*320*4,239*320*4+4)],[0,0,255,255]);assert.deepEqual([...p.subarray(-4)],[255,255,255,255]);
 if(process.env.M5_APP_REVIEW_EVIDENCE){await fs.writeFile(path.join(process.env.M5_APP_REVIEW_EVIDENCE,'native-image-proof.png'),png);await fs.writeFile(path.join(process.env.M5_APP_REVIEW_EVIDENCE,'native-image-proof.json'),JSON.stringify({profile:'cores3se',mode:'native',buildId:result.structuredContent.buildId,sourceSha256:result.structuredContent.sourceSha256,frameSha256:result._meta.frame.sha256,width:320,height:240,fit:'cover',context:imageContext,source:'deterministic four-color PNG; no generated/hardware proof',cornerChecks:'PASS'},null,2)+'\n');}
 await assert.rejects(manager.importImage({sessionId:sid,relativePath:'media-fixtures/review_swatch.png',context:imageContext}),{code:'STALE_RESULT'});
 await manager.stop({sessionId:sid});
});
