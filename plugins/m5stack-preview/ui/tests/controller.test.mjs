import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkbenchController,nativePoint,pressDuration,readResult} from '../controller.mjs';
import {readFileSync} from 'node:fs';

const catalog={profiles:[{id:'atoms3r',label:'AtomS3R C126',width:128,height:128},{id:'stickcplus2',label:'StickC Plus2',width:135,height:240},{id:'cores3',label:'CoreS3',width:320,height:240}],apps:[{id:'custom',label:'My app'},{id:'counter',label:'Input test'}]};
function result(patch={}){
  const structuredContent={sessionId:'session-1',profile:'atoms3r',app:'counter',width:128,height:128,status:'running',revision:1,buildId:'test-build',capabilities:{primaryInput:'button',motion:true,microphone:false},catalog,...patch};
  return {structuredContent,_meta:{frame:{mimeType:'image/png',data:'aGVsbG8=',sha256:'a'.repeat(64),width:structuredContent.width,height:structuredContent.height}}};
}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function settle(){for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));}
function harness(){
  const calls=[],pending=[],timers=new Map();let next=0,id=0;
  const controller=new WorkbenchController({call:request=>{calls.push(request);const d=deferred();pending.push(d);return d.promise;},makeId:()=>`input-${++id}`,schedule:fn=>{timers.set(++next,fn);return next;},cancel:key=>timers.delete(key)});
  return {controller,calls,pending,timers,open:patch=>controller.receive(result(patch)),async answer(patch={}){pending.shift().resolve(result(patch));await settle();},async error(){pending.shift().reject(new Error('Owned fixture disconnect'));await settle();}};
}

test('initial opener result supplies state/catalog without any additional opener/tool call',()=>{
  const h=harness();h.open();assert.equal(h.controller.ready,true);assert.equal(h.calls.length,0);assert.equal(h.timers.size,1);assert.equal(h.controller.catalog.apps.length,2);
});
test('no-workspace opener has no native frame and preserves catalog without starting a worker',()=>{
  const h=harness();h.controller.receive({structuredContent:{status:'welcome',mode:'input-preview',catalog}});h.controller.select({profile:'cores3'});
  assert.equal(h.controller.ready,false);assert.equal(h.calls.length,0);assert.equal(h.timers.size,0);assert.equal(h.controller.frame,null);
});
test('explicit welcome replaces a native session and discards its outstanding result',async()=>{
  const h=harness();h.open();h.controller.input({type:'shake'});
  h.controller.receive({structuredContent:{status:'welcome',mode:'input-preview',sessionId:null,profile:'cores3',catalog}});
  assert.equal(h.controller.state.status,'welcome');assert.equal(h.controller.state.profile,'cores3');assert.equal(h.controller.frame,null);assert.equal(h.timers.size,0);
  await h.answer({revision:2});assert.equal(h.controller.state.status,'welcome');assert.equal(h.controller.frame,null);assert.equal(h.calls.length,1);
});
test('missing native session and pretend native frames cannot become a welcome view',()=>{
  assert.throws(()=>readResult({structuredContent:{status:'stopped',sessionId:null}}),/valid session/);
  assert.throws(()=>readResult({...result(),structuredContent:{status:'welcome',sessionId:null}}),/valid session/);
});
test('latest profile and app intent wins while requests remain strictly serialized',async()=>{
  const h=harness();h.open();h.controller.select({profile:'stickcplus2'});h.controller.select({profile:'cores3'});h.controller.select({app:'custom'});h.controller.select({profile:'atoms3r'});
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].arguments.profile,'stickcplus2');
  await h.answer({sessionId:'session-2',profile:'stickcplus2',width:135,height:240});
  assert.equal(h.calls.length,2);assert.deepEqual(h.calls[1],{name:'m5stack_select',arguments:{profile:'atoms3r',app:'custom',sessionId:'session-2'}});
  await h.answer({sessionId:'session-3',app:'custom'});assert.equal(h.controller.state.app,'custom');assert.equal(h.controller.state.profile,'atoms3r');assert.equal(h.controller.busy,false);
});
test('same selection does not reset app or submit an MCP request',()=>{
  const h=harness();h.open();h.controller.select({profile:'atoms3r',app:'counter'});assert.equal(h.calls.length,0);assert.equal(h.controller.state.sessionId,'session-1');
});
test('one input receives one requestId, rejected duplicates are never replayed',async()=>{
  const h=harness();h.open();assert.equal(h.controller.input({type:'primary',durationMs:1000}),true);
  assert.equal(h.controller.input({type:'primary',durationMs:50}),false);
  assert.deepEqual(h.calls[0],{name:'m5stack_input',arguments:{event:{type:'primary',durationMs:1000},requestId:'input-1',sessionId:'session-1'}});
  await h.answer({revision:2});h.controller.input({type:'shake'});assert.equal(h.calls[1].arguments.requestId,'input-2');
  await h.error();assert.equal(h.calls.length,2);assert.equal(h.controller.ready,false);assert.equal(h.timers.size,0);
});
test('recoverable tool isError responses are handled separately from promise rejection',async()=>{
  const h=harness();h.open();h.controller.select({profile:'cores3'});h.controller.select({app:'custom'});
  h.pending.shift().resolve({isError:true,content:[{type:'text',text:'Build this profile first.'}]});await settle();
  assert.equal(h.controller.state.profile,'atoms3r');assert.equal(h.controller.error,'Build this profile first.');assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
  h.controller.reload();assert.equal(h.calls[1].name,'m5stack_reload');await h.answer({sessionId:'session-2'});assert.equal(h.controller.ready,true);
});
test('stop cancels queued choices and follows an in-flight switch using its new session',async()=>{
  const h=harness();h.open();h.controller.select({profile:'cores3'});h.controller.select({app:'custom'});h.controller.stop();
  assert.equal(h.calls.length,1);assert.equal(h.controller.ready,false);
  await h.answer({sessionId:'session-2',profile:'cores3',width:320,height:240});
  assert.deepEqual(h.calls[1],{name:'m5stack_stop',arguments:{sessionId:'session-2'}});
  h.pending.shift().resolve({structuredContent:{sessionId:'session-2',status:'stopped'}});await settle();
  assert.equal(h.calls.length,2);assert.equal(h.controller.ready,false);assert.equal(h.timers.size,0);
  assert.equal(h.controller.error,'');assert.equal(h.controller.state.width,320);
});
test('pagehide disposal cancels queues, polling, and late response publication',async()=>{
  const h=harness();h.open();h.controller.select({profile:'cores3'});h.controller.select({app:'custom'});h.controller.dispose();
  await h.answer({sessionId:'session-2',profile:'cores3',width:320,height:240});
  assert.equal(h.controller.state.profile,'atoms3r');assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);assert.equal(h.controller.active,false);
});
test('a tool result received from chat supersedes a late response from the old view',async()=>{
  const h=harness();h.open();h.controller.input({type:'shake'});h.controller.receive(result({sessionId:'external-session',profile:'cores3',width:320,height:240}));
  await h.answer({revision:2});assert.equal(h.controller.state.sessionId,'external-session');assert.equal(h.controller.state.profile,'cores3');
});
test('an older revision cannot replace newer pixels and state',async()=>{
  const h=harness();h.open({revision:10});h.controller.input({type:'shake'});await h.answer({revision:9});assert.equal(h.controller.state.revision,10);assert.equal(h.controller.frame.revision,10);
});
for(const status of ['stopped','exited','unavailable'])test('non-running '+status+' clears cached native frame even if a response supplies one',()=>{
  const h=harness();h.open();assert.ok(h.controller.frame);
  const changed=result({status,revision:2});h.controller.receive(changed);
  assert.equal(h.controller.state.status,status);assert.equal(h.controller.frame,null);assert.equal(h.controller.ready,false);assert.equal(h.timers.size,0);
});
test('unavailable snapshot without frame/native state replaces a running session and recovers only with a new frame',()=>{
  const h=harness();h.open({nativeState:{expected_result:{request_id:'old'}}});
  const snapshot=result({status:'unavailable',revision:2}).structuredContent;
  h.controller.receive({structuredContent:snapshot});
  assert.equal(h.controller.frame,null);assert.equal(h.controller.state.nativeState,undefined);assert.equal(h.controller.canRecover,true);
  h.open({revision:3});assert.equal(h.controller.ready,true);assert.equal(h.controller.frame.revision,3);
});
test('polling occurs only while running and visible, and pauses throughout a held input',async()=>{
  const h=harness();h.open();assert.equal(h.timers.size,1);h.controller.holdPolling(true);assert.equal(h.timers.size,0);
  h.controller.armPoll();assert.equal(h.timers.size,0);h.controller.holdPolling(false);assert.equal(h.timers.size,1);
  h.controller.setVisible(false);assert.equal(h.timers.size,0);h.controller.setVisible(true);assert.equal(h.timers.size,1);
  const tick=h.timers.values().next().value;h.timers.clear();tick();assert.equal(h.calls[0].name,'m5stack_frame');
  await h.answer({status:'exited'});assert.equal(h.timers.size,0);assert.equal(h.controller.ready,false);assert.equal(h.controller.canRecover,true);
});
test('a frame refresh leaves inputs available and serializes one click behind the read',async()=>{
  const h=harness(),settled=[];h.open();
  const tick=h.timers.values().next().value;h.timers.clear();tick();
  assert.equal(h.controller.busy,true);assert.equal(h.controller.refreshing,true);assert.equal(h.controller.canInput,true);
  assert.equal(h.controller.input({type:'primary',durationMs:20},{onSettled:value=>settled.push(value)}),true);
  assert.equal(h.controller.canInput,false);assert.equal(h.calls.length,1);
  assert.equal(h.controller.input({type:'primary',durationMs:20}),false);
  await h.answer({revision:2});
  assert.equal(h.calls.length,2);assert.equal(h.calls[1].name,'m5stack_input');
  assert.equal(h.controller.refreshing,false);assert.equal(h.controller.canInput,false);assert.equal(settled.length,0);
  await h.answer({revision:3});
  assert.equal(settled.length,1);assert.equal(settled[0].accepted,true);assert.equal(h.controller.canInput,true);
  h.controller.dispose();
});
test('queued capture authorization requires a revision newer than its dispatch frame',async()=>{
  const h=harness(),settled=[];let accepted=0;h.open();
  const tick=h.timers.values().next().value;h.timers.clear();tick();
  h.controller.input({type:'recording_request'},{onResult:()=>accepted++,onSettled:value=>settled.push(value)});
  await h.answer({revision:2});await h.answer({revision:2});
  assert.equal(accepted,0);assert.equal(settled.length,1);assert.equal(settled[0].accepted,false);
  h.controller.dispose();
});
for(const background of ['frame','mic'])test('queued reload immediately notifies controls behind '+background,async()=>{
  const h=harness(),notifications=[];h.open();
  if(background==='frame'){
    const tick=h.timers.values().next().value;h.timers.clear();tick();
  }else h.controller.input({type:'mic',source:'browser',level:.2});
  h.controller.onChange=controller=>notifications.push({
    background:controller.backgroundRequest,
    queuedReload:controller.queue.some(item=>item.name==='m5stack_reload'),
    canInput:controller.canInput,
  });
  h.controller.reload();
  assert.equal(h.calls.length,1);
  assert.deepEqual(notifications,[{background:true,queuedReload:true,canInput:false}]);
  await h.answer({revision:2});
  assert.equal(h.calls.length,2);assert.equal(h.calls[1].name,'m5stack_reload');
  await h.answer({sessionId:'replacement',revision:1});
  assert.equal(h.controller.canInput,true);h.controller.dispose();
});
test('microphone samples leave one serialized slot for an explicit user action',async()=>{
  const h=harness();h.open();
  assert.equal(h.controller.input({type:'mic',source:'browser',level:.2}),true);
  assert.equal(h.controller.backgroundRequest,true);assert.equal(h.controller.refreshing,false);assert.equal(h.controller.canInput,true);
  assert.equal(h.controller.input({type:'mic',source:'browser',level:.3}),false);
  assert.equal(h.controller.input({type:'recording_request',id:'clip-1',source:'browser'}),true);
  assert.equal(h.controller.canInput,false);assert.equal(h.controller.input({type:'primary',durationMs:20}),false);
  assert.equal(h.calls.length,1);
  await h.answer({revision:2});
  assert.equal(h.calls.length,2);assert.equal(h.calls[1].arguments.event.type,'recording_request');assert.equal(h.controller.backgroundRequest,false);
  await h.answer({revision:3});assert.equal(h.controller.canInput,true);assert.equal(h.controller.backgroundRequest,false);
  h.controller.dispose();
});
test('microphone samples never queue behind a frame read or another action',async()=>{
  const h=harness();h.open();
  const tick=h.timers.values().next().value;h.timers.clear();tick();
  assert.equal(h.controller.input({type:'mic',source:'fixture',level:.4}),false);
  assert.equal(h.controller.queue.length,0);assert.equal(h.controller.canInput,true);
  h.controller.input({type:'primary',durationMs:20});
  assert.equal(h.controller.input({type:'mic',source:'fixture',level:.5}),false);
  await h.answer({revision:2});
  assert.equal(h.controller.input({type:'mic',source:'fixture',level:.6}),false);
  await h.answer({revision:3});
  assert.equal(h.calls.length,2);assert.equal(h.controller.input({type:'mic',source:'fixture',level:.7}),true);
  assert.equal(h.calls[2].arguments.event.level,.7);h.controller.dispose();
});
for(const lifecycle of ['hide-show','select','reload','stop','receive','dispose'])test('input waiting behind a frame is discarded once after '+lifecycle,async()=>{
  const h=harness(),settled=[];let accepted=0;h.open();
  const tick=h.timers.values().next().value;h.timers.clear();tick();
  h.controller.input({type:'recording_request'},{onResult:()=>accepted++,onSettled:value=>settled.push(value)});
  if(lifecycle==='hide-show'){h.controller.setVisible(false);h.controller.setVisible(true);}
  else if(lifecycle==='select')h.controller.select({profile:'cores3'});
  else if(lifecycle==='receive')h.open({sessionId:'replacement'});
  else h.controller[lifecycle]();
  assert.equal(settled.length,1);assert.equal(settled[0].accepted,false);
  await h.answer({revision:2});
  assert.equal(h.calls.filter(call=>call.name==='m5stack_input').length,0);assert.equal(accepted,0);assert.equal(settled.length,1);
  h.controller.dispose();
});
for(const outcome of ['error','exited'])test('queued input never reaches a worker after refresh '+outcome,async()=>{
  const h=harness(),settled=[];h.open();
  const tick=h.timers.values().next().value;h.timers.clear();tick();
  h.controller.input({type:'primary',durationMs:20},{onSettled:value=>settled.push(value)});
  if(outcome==='error')await h.error();else await h.answer({revision:2,status:'exited'});
  assert.equal(h.calls.length,1);assert.equal(settled.length,1);assert.equal(settled[0].accepted,false);
  assert.equal(h.controller.canInput,false);assert.equal(h.controller.refreshing,false);
  h.controller.dispose();
});
test('visibility loss discards selections queued behind a request',async()=>{
  const h=harness();h.open();h.controller.select({profile:'cores3'});h.controller.select({app:'custom'});h.controller.setVisible(false);
  await h.answer({sessionId:'session-2',profile:'cores3',width:320,height:240});assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
  h.controller.setVisible(true);assert.equal(h.calls.length,1);assert.equal(h.timers.size,1);
});
test('touch coordinates are native pixels and bounded; hold duration preserves the one-second threshold',()=>{
  const rect={left:100,top:40,width:640,height:480};assert.deepEqual(nativePoint(rect,320,240,420,280),{x:160,y:120});
  assert.deepEqual(nativePoint(rect,320,240,9999,-50),{x:319,y:0});assert.equal(nativePoint({...rect,width:0},320,240,1,1),null);
  assert.equal(pressDuration(100,1099),999);assert.equal(pressDuration(100,1099.9),999);assert.equal(pressDuration(100,1100),1000);assert.equal(pressDuration(100,999999),60000);assert.equal(pressDuration(100,50),0);
});
test('invalid state and frame dimensions fail closed',()=>{
  assert.throws(()=>readResult(result({width:0})),/invalid/);assert.throws(()=>readResult(result({revision:NaN})),/invalid/);
  const r=result();r._meta.frame.width=320;assert.throws(()=>readResult(r),/does not match/);
});
test('UI transport and lifecycle source has no localhost fetch, capture, serial, or repeated opener',()=>{
  const source=readFileSync(new URL('../main.mjs',import.meta.url),'utf8');
  assert.ok(source.indexOf('app.ontoolresult=')<source.indexOf('await app.connect()'));
  assert.match(source,/availableDisplayModes:\['fullscreen'\]/);assert.match(source,/availableDisplayModes\?\.includes\('fullscreen'\)/);
  assert.equal((source.match(/requestDisplayMode\(/g)||[]).length,1);
  // Passive API availability diagnostics may name these APIs; acquisition and
  // context construction remain owned by explicit-action media adapters.
  assert.doesNotMatch(source,/\bfetch\s*\(|127\.0\.0\.1|localhost|\bgetUserMedia\s*\(|\bnew\s+(?:[\w.]+\.)?AudioContext\s*\(|navigator\.serial|m5stack_open/);
  assert.match(source,/new OpenAIExtensions\(app\)/);assert.match(source,/app\.callServerTool/);
});
test('explicit input completion receives only its fresh committed response and hooks stay off the wire',async()=>{
  const h=harness(),received=[],settled=[];h.open();
  h.controller.input({type:'recording_request',id:'clip-1',source:'browser'},{onResult:value=>received.push(value),onSettled:value=>settled.push(value)});
  assert.deepEqual(Object.keys(h.calls[0].arguments).sort(),['event','requestId','sessionId']);
  await h.answer({revision:2,nativeState:{capture_intent:{id:'app-clip',source:'browser',action:'start',sequence:1}}});
  assert.equal(received.length,1);assert.equal(received[0].structuredContent.nativeState.capture_intent.id,'app-clip');
  assert.equal(settled.length,1);assert.equal(settled[0].accepted,true);
});
for(const lifecycle of ['hide-show','select','reload','stop','receive','dispose'])test('input completion cannot authorize capture after '+lifecycle,async()=>{
  const h=harness(),received=[],settled=[];h.open();
  h.controller.input({type:'recording_request',id:'clip-1',source:'browser'},{onResult:value=>received.push(value),onSettled:value=>settled.push(value)});
  if(lifecycle==='hide-show'){h.controller.setVisible(false);h.controller.setVisible(true);}
  else if(lifecycle==='select')h.controller.select({profile:'cores3'});
  else if(lifecycle==='receive')h.open({sessionId:'replacement'});
  else h.controller[lifecycle]();
  await h.answer({revision:2});assert.equal(received.length,0);assert.equal(settled.length,1);assert.equal(settled[0].accepted,false);
  h.controller.dispose();
});
test('input callback rejects old/equal revisions and tool errors without retry',async()=>{
  for(const revision of [1,9,10]){
    const h=harness();let admitted=0;h.open({revision:10});h.controller.input({type:'recording_request'},{onResult:()=>admitted++});
    await h.answer({revision});assert.equal(admitted,0);assert.equal(h.calls.length,1);h.controller.dispose();
  }
  const h=harness(),settled=[];let admitted=0;h.open();h.controller.input({type:'recording_request'},{onResult:()=>admitted++,onSettled:value=>settled.push(value)});
  await h.error();assert.equal(admitted,0);assert.equal(settled.length,1);assert.equal(settled[0].accepted,false);assert.equal(h.calls.length,1);
});
