import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSession} from '../server/native-session.mjs';
import {createM5StackServer} from '../server/dist/application-server.js';

const workspace=process.env.M5_POWER_REVIEW_WORKSPACE,fixture=process.env.M5_POWER_REVIEW_FIXTURE,legacy=process.env.M5_POWER_REVIEW_LEGACY;
function session(profileId='cores3se',appId='custom',marker=1){
  const s=new NativeSession({profile:{id:profileId,width:320,height:240,primaryInput:'touch',motion:profileId==='cores3',microphone:true,audioOutput:'speaker'},meta:{build_id:'power-test',source_sha256:'a'.repeat(64)}},{profileId,appId});
  s._state={profile:profileId,app:appId,app_adapter:1,power_button_adapter:marker};s._status='running';return s;
}
const power=action=>({type:'power',action});
const send=(s,requestId,event)=>s.input({sessionId:s.sessionId,requestId,event});
async function open(t,root=workspace,profileId='cores3se',appId='custom'){const s=await NativeSession.open({workspaceRoot:root,profileId,appId});t.after(()=>s.close());return s;}
test('POWER capability requires exact worker marker, Core identity and counter/custom app',()=>{
  for(const profile of ['cores3','cores3se'])for(const app of ['counter','custom']){
    const s=session(profile,app);assert.equal(s.snapshot().capabilities.powerButton,true);assert(s.snapshot().capabilities.implementedInputs.includes('power'));
    for(const action of ['click','hold'])assert.equal(s._eventCommand(power(action)),`power ${action}\n`);
  }
  for(const s of [session('atoms3r'),session('stickcplus2'),session('sticks3'),session('cores3-se'),session('cores3','trail'),session('cores3se','trail'),...['1',0,2,null,false].map(marker=>session('cores3se','custom',marker))]){
    assert.equal(s.snapshot().capabilities.powerButton,false);assert.equal(s.snapshot().capabilities.implementedInputs.includes('power'),false);
    assert.throws(()=>s._eventCommand(power('click')),{code:'UNSUPPORTED_INPUT'});
  }
  const old=session();delete old._state.power_button_adapter;assert.equal(old.snapshot().capabilities.powerButton,false);
  const noApp=session();delete noApp._state.app_adapter;assert.equal(noApp.snapshot().capabilities.powerButton,false);
  for(const profile of ['atoms3r','stickcplus2']){
    const forged=session(profile);forged._state.profile='cores3se';
    assert.equal(forged.snapshot().capabilities.powerButton,false);assert.throws(()=>forged._eventCommand(power('click')),{code:'UNSUPPORTED_INPUT'});
  }
  const mismatched=session('cores3');mismatched._state.profile='cores3se';assert.equal(mismatched.snapshot().capabilities.powerButton,false);
});
test('POWER uses strict semantic actions without accepting timing, reset or extra keys',()=>{
  const s=session();for(const event of [{type:'power'},{type:'power',action:'reset'},{type:'power',action:'CLICK'},{type:'power',action:1},{type:'power',action:'click',durationMs:1000},{type:'power',action:'hold',x:1},{type:'power',action:'click',source:'physical'}])
    assert.throws(()=>s._eventCommand(event),{code:'INVALID_INPUT'});
});
test('forged Core worker frame with POWER marker cannot replace an Atom or Stick session',async()=>{
  for(const profile of ['atoms3r','stickcplus2']){
    const s=session(profile),pending=s._expectFrame();pending.catch(()=>{});
    s._read(Buffer.from(JSON.stringify({profile:'cores3se',app:'custom',width:320,height:240,app_adapter:1,power_button_adapter:1})+'\n'));
    await assert.rejects(pending,{code:'INVALID_GEOMETRY'});assert.equal(s.snapshot().capabilities.powerButton,false);assert.equal(s.snapshot().status,'unavailable');
  }
});
test('public MCP input schema forwards exact POWER actions and rejects extra properties',async t=>{
  const received=[],manager={observe(){},async close(){},async input(args){received.push(args);return{content:[],structuredContent:{accepted:true}};}};
  const instance=createM5StackServer({manager});let next=0;const pending=new Map();
  const transport={async start(){},async close(){},async send(message){const waiter=pending.get(message.id);if(waiter){clearTimeout(waiter.timer);pending.delete(message.id);message.error?waiter.reject(Error(JSON.stringify(message.error))):waiter.resolve(message.result);}}};
  await instance.start({transport,lifecycle:false});t.after(()=>instance.close());
  const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('Synthetic MCP input deadline'));},3000);pending.set(id,{resolve,reject,timer});transport.onmessage({jsonrpc:'2.0',id,method,params});});
  await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'power-schema-test',version:'1'}});transport.onmessage({jsonrpc:'2.0',method:'notifications/initialized'});
  const call=event=>rpc('tools/call',{name:'m5stack_input',arguments:{sessionId:'fixture',requestId:'request_'+next,event}});
  for(const action of ['click','hold'])assert.equal((await call(power(action))).structuredContent.accepted,true);
  for(const event of [{type:'power',action:'reset'},{type:'power',action:'hold',durationMs:1000},{type:'power',action:'click',extra:true},{type:'power'}])assert.equal((await call(event)).isError,true);
  assert.deepEqual(received.map(value=>value.event),[power('click'),power('hold')]);
});
for(const profile of ['cores3','cores3se'])for(const app of ['counter','custom'])test(`native ${profile}/${app}: POWER is app input and never resets starter state`,{skip:!workspace},async t=>{
  const s=await open(t,workspace,profile,app),first=await send(s,'touch',{type:'primary',durationMs:20,x:20,y:20});
  assert.equal(first.capabilities.powerButton,true);assert.equal(first.nativeState.count,1);
  for(const action of ['click','hold']){const result=await send(s,action,power(action));assert.equal(result.nativeState.app_input_accepted,true);assert.equal(result.nativeState.count,1);assert.equal(result.frame.sha256,first.frame.sha256);}
  const current=s.snapshot(),duplicate=await send(s,'hold',power('hold'));assert.equal(duplicate.revision,current.revision);
  assert.equal((await s.refresh()).nativeState.app_input_accepted,null);assert.equal(s.snapshot().status,'running');
});
test('native non-Core and trail profiles reject POWER before worker input',{skip:!workspace},async t=>{
  for(const [profile,app] of [['atoms3r','custom'],['stickcplus2','custom'],['cores3','trail'],['cores3se','trail']]){
    const s=await open(t,workspace,profile,app);assert.equal(s.snapshot().nativeState.power_button_adapter,undefined);assert.equal(s.snapshot().capabilities.powerButton,false);
    await assert.rejects(send(s,'power',power('click')),{code:'UNSUPPORTED_INPUT'});assert.equal(s.snapshot().status,'running');
  }
});
test('authored app distinguishes click and hold and may reject without native process exit',{skip:!fixture},async t=>{
  const s=await open(t,fixture);const denied=await send(s,'denied',power('hold'));assert.equal(denied.nativeState.app_input_accepted,false);assert.equal(denied.nativeState.count,0);
  assert.equal((await send(s,'click',power('click'))).nativeState.count,10);
  const accepted=await send(s,'hold',power('hold'));assert.equal(accepted.nativeState.count,110);assert.equal(accepted.nativeState.app_input_accepted,true);assert.equal(accepted.status,'running');
});
test('older native worker without POWER marker stays compatible and rejects POWER before write',{skip:!legacy},async t=>{
  const s=await open(t,legacy);assert.equal(s.snapshot().capabilities.powerButton,false);
  await assert.rejects(send(s,'power',power('hold')),{code:'UNSUPPORTED_INPUT'});
  assert.equal((await send(s,'touch',{type:'primary',durationMs:20,x:20,y:20})).nativeState.count,1);assert.equal(s.snapshot().status,'running');
});
