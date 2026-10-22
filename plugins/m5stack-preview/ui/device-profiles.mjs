// The same exact-SKU registry feeds the host, browser and generated C++ table.
// It describes implemented simulation profiles, not automatic driver support.
import profiles from '../runtime/data/device-profiles.json' with {type:'json'};
function freeze(value) {
  if(value && typeof value==='object') {Object.values(value).forEach(freeze);Object.freeze(value);}
  return value;
}
export const DEVICE_PROFILES=freeze(profiles);
export const DEVICE_PROFILE_BY_ID=freeze(Object.fromEntries(profiles.map(p=>[p.id,p])));
export const DEVICE_MEDIA_CAPABILITIES=freeze(Object.fromEntries(profiles.map(p=>[p.id,{microphone:p.microphone,audioOutput:p.audioOutput}])));
