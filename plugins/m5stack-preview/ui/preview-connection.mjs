const restart = 'Rerun the emulator from Codex or your local launcher, then open the new browser link.';
const messages = {
  disconnected: ['Emulator disconnected', 'The local emulator is no longer reachable. It may have stopped. '+restart],
  expired: ['Session expired', 'This temporary browser preview has reached its time limit. '+restart],
  access: ['Preview link unavailable', 'This browser link does not have access to the current emulator. '+restart],
  timeout: ['Emulator is not responding', 'The last action could not be confirmed. Check the connection before starting a new action. No recording or transcription will be retried automatically.'],
  invalid: ['Emulator connection interrupted', 'The local emulator returned an unexpected response. '+restart],
};
export class PreviewConnectionError extends Error {
  constructor(code) {const [title,detail]=messages[code]??messages.invalid;super(detail);this.name='PreviewConnectionError';this.code=code;this.title=title;}
}

// Never retry a tool call: a lost response does not establish that it was not applied.
export function createPreviewClient({token,fetchImpl=globalThis.fetch,now=Date.now,onUnavailable=()=>{},timeoutMs=10000}) {
  let expiresAt=null;
  function unavailable(code) {
    const error=new PreviewConnectionError(code);onUnavailable(error);return error;
  }
  async function request(route,value) {
    if(!/^[a-f0-9]{64}$/.test(token))throw unavailable('access');
    let response;
    try {
      response=await fetchImpl(route,{method:value?'POST':'GET',cache:'no-store',
        signal:AbortSignal.timeout(timeoutMs),
        headers:{'X-M5-Preview-Token':token,...(value?{'Content-Type':'application/json'}:{})},
        ...(value?{body:JSON.stringify(value)}:{})});
    }catch(error){throw unavailable(expiresAt!==null&&now()>=expiresAt?'expired':error?.name==='TimeoutError'?'timeout':'disconnected');}
    if(response.status===401||response.status===403)throw unavailable('access');
    if(response.status===410)throw unavailable('expired');
    if(response.status>=500)throw unavailable('disconnected');
    // Backpressure and invalid actions do not establish a lost server.
    if(!response.ok)throw new Error(response.status===429?'The emulator is busy. Wait for the current action to finish.':'The emulator could not complete this action. Reset the app to try again.');
    let data;
    try{data=await response.json();}catch{throw unavailable('invalid');}
    if(route==='/api/bootstrap') {
      if(!data?.result||typeof data.result!=='object')throw unavailable('invalid');
      expiresAt=Number.isSafeInteger(data.expiresAt)?data.expiresAt:null;
      if(expiresAt!==null&&now()>=expiresAt)throw unavailable('expired');
    }
    return data;
  }
  return {request};
}
