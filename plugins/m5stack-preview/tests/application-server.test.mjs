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
  assert.deepEqual(hardware.inputSchema.properties.profile.enum,['cores3se','cores3','atoms3r','sticks3']);
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
test('kit questions return the packaged inventory and retain exact hardware lookup', async t => {
  const c = await client(t, createM5StackServer());
  const lookup = async device => (await c.call('m5stack_device_guide', {device})).structuredContent;
  const catalog = (await c.call('m5stack_catalog')).structuredContent;
  assert.match(catalog.accessories.guideQuery, /kit/);
  const kit = await lookup('kit');
  assert.equal(kit.kind, 'kit_guide');
  for (const sku of ['K128', 'K150', ...catalog.accessories.entries.map(entry => entry.sku)]) {
    assert.ok(kit.guide.includes(sku), sku);
  }
  for (const phrase of ['What’s in the box?', 'round stickers', 'little wrench', 'small pieces', 'DIN rail clip']) {
    assert.equal((await lookup(phrase)).guide, kit.guide, phrase);
  }
  assert.match(kit.guide, /2\.5 mm Allen key/);
  assert.match(kit.guide, /Four small screw-mount clips and a rail clip/);
  assert.match(kit.guide, /NDEF/);
  assert.match(kit.guide, /physical test/);
  const rfid = await lookup('U031-B');
  assert.match(rfid.accessory.kit_stickers.use_by_id, /without writing/);
  assert.equal(rfid.firmwareAdapterImplemented, false);
  assert.equal((await lookup('K128-SE')).device.sku, 'K128-SE');
  assert.equal((await lookup('unidentified mounting bracket')).status, 'research-only');
});

test('accessory references are discoverable without enabling emulator or firmware capabilities',async t=>{
  const c=await client(t,createM5StackServer());
  const catalog=(await c.call('m5stack_catalog')).structuredContent;
  assert.equal(catalog.profiles.length,5);
  assert.deepEqual(catalog.accessories.entries.map(x=>x.sku),['M145','U031-B','U127','U032-V11','U053-D','U072']);
  assert.equal(catalog.accessories.support.status,'knowledge_only');
  for(const entry of catalog.accessories.entries){
    assert.equal(entry.simulationSupported,false);
    const guide=(await c.call('m5stack_device_guide',{device:entry.sku})).structuredContent;
    assert.equal(guide.kind,'accessory');assert.equal(guide.accessory.sku,entry.sku);
    assert.equal(guide.simulationSupported,false);assert.equal(guide.firmwareAdapterImplemented,false);
    assert.equal(guide.accessory.support.physical_validation,'not_run');
    assert.ok(guide.accessory.sources.every(source=>source.url.startsWith('https://')));
    const named=(await c.call('m5stack_device_guide',{device:entry.name.toLowerCase()})).structuredContent;
    assert.equal(named.accessory.id,entry.id);
  }
  assert.equal((await c.call('m5stack_device_guide',{device:'accessories'})).structuredContent.kind,'accessory_catalog');
  const host=(await c.call('m5stack_device_guide',{device:'cores3'})).structuredContent;
  assert.ok(host.accessoryReferences.some(x=>x.sku==='M145'));
  assert.equal(host.device.physical_firmware.implemented,true);
  assert.equal(host.device.physical_firmware.physical_validation,'not_run');
  for(const query of ['U031','U032','U053-C','Unit GPS v2','../../plugin.json']){
    const result=(await c.call('m5stack_device_guide',{device:query})).structuredContent;
    assert.equal(result.status,'research-only');assert.equal(result.simulationSupported,false);
  }
  const revision=(await c.call('m5stack_device_guide',{device:'U053-D',revision:'unknown PCB revision'})).structuredContent;
  assert.equal(revision.revisionConfirmed,false);
  assert.equal(revision.accessory.host_bindings[0].pins,null);
  const rejected=await c.call('m5stack_open',{profile:'U072'});
  assert.equal(rejected.isError,true);
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
