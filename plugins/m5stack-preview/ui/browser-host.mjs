import {AppBridge, PostMessageTransport} from '@modelcontextprotocol/ext-apps/app-bridge';
import {createPreviewClient,PreviewConnectionError} from './preview-connection.mjs';

const frame = document.getElementById('workbench'), error = document.getElementById('error');
const token = location.hash.slice(1);
function failed(reason) {
  const issue=reason instanceof PreviewConnectionError?reason:new PreviewConnectionError('invalid');
  document.getElementById('error-title').textContent=issue.title;
  document.getElementById('error-detail').textContent=issue.message;
  error.hidden=false;
  // Unload to release the microphone even if a device MCP call is still pending.
  // Reconnecting never restores capture or replays the interrupted action.
  if(!frame.hidden){frame.hidden=true;frame.src='about:blank';}
}
const {request:api}=createPreviewClient({token,onUnavailable:failed});
const reconnect=document.getElementById('reconnect');
reconnect.addEventListener('click',async()=>{
  reconnect.disabled=true;reconnect.textContent='Checking…';
  try{await api('/api/bootstrap');location.reload();}
  catch(reason){failed(reason);}
  finally{reconnect.disabled=false;reconnect.textContent='Check connection';}
});
try {
  const {result} = await api('/api/bootstrap');
  const bridge = new AppBridge(null, {name: 'M5Stack local browser', version: '1.0.0'},
    {serverTools: {}, sandbox: {permissions: {microphone: {}}}},
    {hostContext: {displayMode: 'fullscreen', availableDisplayModes: ['fullscreen'], theme: 'light',
      userAgent: 'M5Stack local browser preview', platform: 'desktop'}});
  bridge.oncalltool = async params => {
    try{return await api('/api/tool', {name: params.name, arguments: params.arguments});}
    catch(reason){return {isError:true,content:[{type:'text',text:reason.message}]};}
  };
  bridge.onrequestdisplaymode = async () => ({mode: 'fullscreen'});
  bridge.oninitialized = () => { void (async () => {
    await bridge.sendToolInput({arguments: {}});
    await bridge.sendToolResult(result);
  })().catch(failed); };
  frame.hidden = false;
  await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow));
  frame.src = '/workbench.html';
  const suspend=()=>{void api('/api/lifecycle',{state:'hidden'}).catch(()=>{});};
  document.addEventListener('visibilitychange',()=>{if(document.hidden)suspend();});
  window.addEventListener('pagehide',suspend,{once:true});
  window.addEventListener('pagehide', () => { void bridge.close(); }, {once: true});
} catch(reason) { failed(reason); }
