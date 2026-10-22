import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewClient,PreviewConnectionError} from '../preview-connection.mjs';
const token='a'.repeat(64);
const json=(value,status=200)=>({ok:status<400,status,json:async()=>value});
const action={name:'m5stack_input',arguments:{event:{type:'primary'}}};

test('connection refusal has an actionable error and never retries a possibly applied input',async()=>{
  const calls=[],issues=[];
  const client=createPreviewClient({token,fetchImpl:async(...args)=>{calls.push(args);throw new TypeError('Failed to fetch (private host details)');},onUnavailable:e=>issues.push(e)});
  await assert.rejects(client.request('/api/tool',action),error=>error instanceof PreviewConnectionError&&error.title==='Emulator disconnected'&&/Rerun the emulator/.test(error.message));
  assert.equal(calls.length,1);assert.equal(issues.length,1);assert.doesNotMatch(issues[0].message,/private host|MCP|fetch/);
  assert.equal(calls[0][1].method,'POST');assert.deepEqual(JSON.parse(calls[0][1].body),action);
});
test('expiry is reported only after the server-provided deadline, including wake after sleep',async()=>{
  let now=1000,offline=false;const issues=[];
  const client=createPreviewClient({token,now:()=>now,onUnavailable:e=>issues.push(e),fetchImpl:async()=>{if(offline)throw new TypeError('Failed to fetch');return json({result:{},expiresAt:2000});}});
  await client.request('/api/bootstrap');offline=true;
  await assert.rejects(client.request('/api/tool',action),{code:'disconnected'});
  now=2000;await assert.rejects(client.request('/api/tool',action),{code:'expired'});
  assert.match(issues[1].message,/time limit/);
});
for(const [status,code] of [[401,'access'],[403,'access'],[410,'expired'],[503,'disconnected']])test('HTTP '+status+' classifies the failure without exposing response details',async()=>{
  const client=createPreviewClient({token,fetchImpl:async()=>json({error:'secret detail'},status)});
  await assert.rejects(client.request('/api/bootstrap'),e=>e.code===code&&!e.message.includes('secret'));
});
test('busy or rejected operations preserve the emulator instead of claiming it stopped',async()=>{
  for(const status of [429,400]){
    const client=createPreviewClient({token,fetchImpl:async()=>json({},status),onUnavailable:()=>assert.fail('not disconnected')});
    await assert.rejects(client.request('/api/tool',action),e=>!(e instanceof PreviewConnectionError));
  }
});
test('a connection check is a read-only bootstrap and cannot replay an action',async()=>{
  const calls=[];let fail=true;
  const client=createPreviewClient({token,fetchImpl:async(route,options)=>{calls.push({route,options});if(fail)throw new TypeError();return json({result:{structuredContent:{status:'running'}}});}});
  await assert.rejects(client.request('/api/tool',action));fail=false;await client.request('/api/bootstrap');
  assert.deepEqual(calls.map(c=>c.options.method),['POST','GET']);assert.equal(calls[1].options.body,undefined);
});
test('an invalid link never contacts a server',async()=>{
  const client=createPreviewClient({token:'missing',fetchImpl:async()=>assert.fail()});
  await assert.rejects(client.request('/api/bootstrap'),{code:'access'});
});
test('timeouts and malformed responses produce clear distinct errors',async()=>{
  const client=createPreviewClient({token,fetchImpl:async()=>{throw {name:'TimeoutError'};}});
  await assert.rejects(client.request('/api/tool',action),e=>e.code==='timeout'&&/could not be confirmed/.test(e.message));
  const malformed=createPreviewClient({token,fetchImpl:async()=>json({wrong:true})});
  await assert.rejects(malformed.request('/api/bootstrap'),{code:'invalid'});
});
