// Validate an extracted distribution without installing it or accessing USB.
// Optional --workspace runs trusted, freshly built starter workers, not mocks.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const plugin=path.join(root,'plugins/m5stack-preview');
const metadata=JSON.parse(await readFile(path.join(plugin,'plugin.json'),'utf8'));
const profiles=['atoms3r','stickcplus2','sticks3','cores3','cores3se'];
const args=process.argv.slice(2);
if(args.length && (args.length!==2 || args[0]!=='--workspace' || !path.isAbsolute(args[1])))
  throw new Error('Usage: node scripts/smoke.mjs [--workspace /absolute/trusted-starter-workspace]');

// Exercise the same launcher/arguments that a real local plugin install uses.
const manifest=JSON.parse(await readFile(path.join(plugin,'mcp.json'),'utf8'));
const server=manifest.mcpServers['m5stack-preview'];
assert.equal(server.type,'stdio');
const resolveRoot=value=>value.replaceAll('${PLUGIN_ROOT}',plugin);
const child=spawn(server.command,server.args.map(resolveRoot),{
  cwd:resolveRoot(server.cwd),stdio:['pipe','pipe','pipe'],
  env:{...process.env,PATH:path.dirname(process.execPath)+path.delimiter+(process.env.PATH??'')},
});
let next=0,stderr='',exitCode;
const pending=new Map();
child.stderr.on('data',bytes=>{stderr=(stderr+bytes).slice(-4096);});
const lines=createInterface({input:child.stdout});
function rejectAll(error){for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();}
lines.on('line',line=>{
  let message;try{message=JSON.parse(line);}catch{rejectAll(new Error('Non-JSON data on MCP stdout'));return;}
  const p=pending.get(message.id);if(!p)return;
  clearTimeout(p.timer);pending.delete(message.id);
  message.error?p.reject(new Error(JSON.stringify(message.error))):p.resolve(message.result);
});
child.on('error',rejectAll);
child.on('exit',code=>{exitCode=code;rejectAll(new Error('MCP server exited before completing requests'));});
const send=message=>child.stdin.write(JSON.stringify({jsonrpc:'2.0',...message})+'\n');
const rpc=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(new Error('MCP timeout: '+method));},10000);
  pending.set(id,{resolve,reject,timer});send({id,method,params});
});
const call=async(name,args={})=>{const result=await rpc('tools/call',{name,arguments:args});assert.notEqual(result.isError,true,name);return result;};
try{
  const init=await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'community-package-smoke',version:'1'}});
  assert.equal(init.serverInfo.version,metadata.version);
  send({method:'notifications/initialized'});
  assert.equal((await rpc('tools/list')).tools.length,14);
  const catalog=(await call('m5stack_catalog')).structuredContent;
  assert.deepEqual(catalog.profiles.map(p=>p.id).sort(),[...profiles].sort());
  for(const profile of profiles){
    const guide=(await call('m5stack_device_guide',{device:profile})).structuredContent;
    assert.equal(guide.device.native_preview.runtime_profile,profile);
  }
  const resource=await rpc('resources/read',{uri:'ui://m5stack-preview/workbench.html'});
  assert.match(resource.contents[0].text,/audio-settings-heading/);
  assert.doesNotMatch(resource.contents[0].text,/id="(?:voice-transcript|record-toggle|image-controls|sound-test)"/);
  console.log('PASS: packaged MCP launcher, stdio server, version, 14 tools, five exact guides and fixed UI resource');
}catch(error){if(stderr)console.error(stderr);throw error;}
finally{
  child.stdin.end();
  if(exitCode===undefined)await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill();resolve();},2000);child.once('exit',()=>{clearTimeout(timer);resolve();});});
  lines.close();rejectAll(new Error('Smoke client closed'));
}

if(args.length){
  const {NativeSession}=await import('../plugins/m5stack-preview/server/native-session.mjs');
  const pcm=Buffer.alloc(3200);for(let i=0;i<1600;i++)pcm.writeInt16LE(i%2?8192:-8192,i*2);
  for(const profileId of profiles){
    const session=await NativeSession.open({workspaceRoot:args[1],profileId});
    let requestId=0;
    const input=event=>session.input({sessionId:session.sessionId,requestId:String(++requestId),event});
    const audio=(action,extra={})=>session.audio({sessionId:session.sessionId,streamId:'package_fixture',action,...extra});
    try{
      assert.equal(session.snapshot().nativeState.count,0);
      const pressed=(await input({type:'primary',durationMs:80})).nativeState;
      assert.equal(pressed.count,1);
      if(profileId==='atoms3r')assert.equal(pressed.app_sound,null);
      else {assert.equal(pressed.app_sound.cue,'hello_click');assert.equal(pressed.app_sound.duration_ms,70);}
      if(['stickcplus2','sticks3'].includes(profileId)){
        assert.equal((await input({type:'secondary',durationMs:80})).nativeState.user_app.alternate,true);
      }
      if(profileId==='atoms3r'){
        await assert.rejects(audio('start',{source:'fixture'}),{code:'UNSUPPORTED_AUDIO'});
      }else{
        assert.equal((await audio('start',{source:'fixture'})).active,true);
        await audio('chunk',{sequence:0,firstFrame:0,pcmBase64:pcm.toString('base64')});
        const state=(await input({type:'primary',durationMs:80})).nativeState;
        assert.equal(state.count,2);assert.equal(state.audio_input.received_frames,1600);
        assert.ok(Math.abs(state.audio_input.level-0.25)<0.0001,`${profileId}: PCM level`);
        assert.equal((await audio('stop')).active,false);
      }
      assert.equal((await input({type:'primary',durationMs:1200})).nativeState.count,0);
      console.log(`PASS: ${profileId} native starter controls; ${profileId==='atoms3r'?'absent mic rejected':'1600 known PCM frames, expected RMS, controls during input and stop'}`);
    }finally{await session.close();}
  }
  pcm.fill(0);
}
