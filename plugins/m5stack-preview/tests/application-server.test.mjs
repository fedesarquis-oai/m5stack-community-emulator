// Exercise the distributable factory via a public transport interface; synthetic
// audio, app adapter and native manager only. No key, network or media access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createM5StackServer} from '../server/dist/application-server.js';
import {pcmFixture} from './pcm-fixture.mjs';

async function client(t,instance){
  let next=0;const pending=new Map();
  const transport={async start(){},async close(){},async send(message){const p=pending.get(message.id);if(p){clearTimeout(p.timer);pending.delete(message.id);message.error?p.reject(new Error(JSON.stringify(message.error))):p.resolve(message.result);}}};
  await instance.start({transport,lifecycle:false});t.after(()=>instance.close());
  const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Synthetic MCP call timed out'));},3000);pending.set(id,{resolve,reject,timer});transport.onmessage({jsonrpc:'2.0',id,method,params});});
  await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'synthetic-factory-test',version:'1'}});
  transport.onmessage({jsonrpc:'2.0',method:'notifications/initialized'});
  return {rpc,call:(name,args={})=>rpc('tools/call',{name,arguments:args})};
}
test('base factory exposes 14 generic tools with no provider or voice transfer',async t=>{
  const instance=createM5StackServer(),c=await client(t,instance);
  const tools=(await c.rpc('tools/list',{})).tools;
  assert.equal(tools.length,14);assert.equal(tools.some(tool=>/voice|transcrib/.test(tool.name)),false);
  const hardware=tools.find(tool=>tool.name==='m5stack_hardware');
  assert.deepEqual(hardware._meta.ui.visibility,['model']);
  assert.equal(hardware.annotations.destructiveHint,true);
  assert.deepEqual(hardware.inputSchema.properties.profile.enum,['cores3se','atoms3r','sticks3']);
  assert.deepEqual([...hardware.inputSchema.properties.action.enum].sort(),['status','setup','devices','build','backup','install','restore','monitor','network-prepare','network-configure','network-forget'].sort());
  const resource=await c.rpc('resources/read',{uri:'ui://m5stack-preview/workbench.html'});
  assert.match(resource.contents[0].text,/audio-settings-heading/);
  assert.doesNotMatch(resource.contents[0].text,/id="(?:voice-transcript|record-toggle|image-controls|sound-test)"/);
});
test('bounded microphone tool is app-only and forwards fixed local stream operations',async t=>{
  const calls=[];
  const manager={observe(){},async close(){},async audio(args){calls.push(args);return {content:[{type:'text',text:'Microphone operation acknowledged.'}],structuredContent:{sessionId:args.sessionId,streamId:args.streamId,action:args.action,accepted:true,sequence:-1,nextFrame:0,requested:true,active:true}};}};
  const c=await client(t,createM5StackServer({manager}));
  const tools=(await c.rpc('tools/list',{})).tools,tool=tools.find(value=>value.name==='m5stack_audio');
  assert.deepEqual(tool._meta.ui.visibility,['app']);assert.equal(tool.annotations.openWorldHint,true);
  const result=await c.call('m5stack_audio',{sessionId:'session',streamId:'stream',action:'start',source:'browser'});
  assert.equal(result.structuredContent.accepted,true);assert.equal(calls.length,1);assert.equal('_meta'in result,false);
  const bad=await c.call('m5stack_audio',{sessionId:'session',streamId:'stream',action:'chunk',sequence:0,firstFrame:0,pcmBase64:'A'.repeat(4272)});
  assert.equal(bad.isError,true);assert.equal(calls.length,1);
});

// Query actual distributable metadata and knowledge, not internal registry helpers.
test('all catalog profile IDs resolve to their exact knowledge entry; unknown revisions do not alias',async t=>{
  const c=await client(t,createM5StackServer());
  const profiles=(await c.call('m5stack_catalog')).structuredContent.profiles;
  assert.equal(profiles.length,5);
  for(const profile of profiles){
    const result=(await c.call('m5stack_device_guide',{device:profile.id})).structuredContent;
    assert.equal(result.device.native_preview.runtime_profile,profile.id);
    const sku=(await c.call('m5stack_device_guide',{device:result.device.sku})).structuredContent;
    assert.equal(sku.device.id,result.device.id);
  }
  const unknown=(await c.call('m5stack_device_guide',{device:'CoreS3 SE unknown revision 999'})).structuredContent;
  assert.equal(unknown.status,'research-only');assert.equal(unknown.simulationSupported,false);
});
test('every tool that runs app code advertises possible external effects; pure guidance stays read-only',async t=>{
  const c=await client(t,createM5StackServer());
  const tools=(await c.rpc('tools/list',{})).tools;
  for(const name of ['open','build','reload','select','frame','input','audio','set_text','import_image']){
    const tool=tools.find(t=>t.name==='m5stack_'+name);
    assert.deepEqual(tool.annotations,{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true},name);
  }
  for(const name of ['catalog','device_guide','doctor']){
    assert.equal(tools.find(t=>t.name==='m5stack_'+name).annotations.readOnlyHint,true,name);
  }
  const stop=tools.find(t=>t.name==='m5stack_stop');
  assert.equal(stop.annotations.openWorldHint,false);assert.equal(stop.annotations.idempotentHint,true);
});
