// Passive observations only. Neither advertisement nor Permissions Policy
// establishes that a user granted access or that an AudioContext can run.
const read = callback => {try{return callback();}catch{return undefined;}};

export function readHostMediaSupport({
  hostCapabilities,
  document=globalThis.document,
  navigator=globalThis.navigator,
  AudioContext=globalThis.AudioContext??globalThis.webkitAudioContext,
  AudioWorkletNode=globalThis.AudioWorkletNode,
  isSecureContext=globalThis.isSecureContext,
}={}){
  const microphone=read(()=>hostCapabilities?.sandbox?.permissions?.microphone);
  const advertised=!!microphone && typeof microphone==='object' && !Array.isArray(microphone);
  const policy=read(()=>document?.permissionsPolicy??document?.featurePolicy);
  const allowed=read(()=>typeof policy?.allowsFeature==='function'?policy.allowsFeature('microphone'):undefined);
  return Object.freeze({
    hostMicrophone:advertised?'advertised':'not-reported',
    microphonePolicy:allowed===true?'allowed':allowed===false?'blocked':'unknown',
    secureContext:typeof isSecureContext==='boolean'?isSecureContext:null,
    audioContextAvailable:typeof AudioContext==='function',
    // Presence of the node constructor does not prove addModule/Blob support.
    audioWorkletAvailable:typeof AudioWorkletNode==='function',
    getUserMediaAvailable:read(()=>typeof navigator?.mediaDevices?.getUserMedia==='function')===true,
  });
}
