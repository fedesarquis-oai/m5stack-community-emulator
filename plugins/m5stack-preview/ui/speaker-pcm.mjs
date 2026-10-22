export function validSpeakerPacket(p) {
  return p && typeof p==='object' && !Array.isArray(p) &&
    Object.keys(p).length===8 && ['generation','sequence','sample_rate','channels','first_frame','total_frames','active','pcm_s16le'].every(k=>Object.hasOwn(p,k)) &&
    Number.isSafeInteger(p.generation) && p.generation>=0 && Number.isSafeInteger(p.sequence) && p.sequence>=0 &&
    Number.isInteger(p.sample_rate) && p.sample_rate>=8000 && p.sample_rate<=48000 && p.channels===1 &&
    Number.isInteger(p.first_frame) && p.first_frame>=0 && Number.isInteger(p.total_frames) && p.total_frames>=p.first_frame && p.total_frames<=p.sample_rate*30 &&
    typeof p.active==='boolean' && typeof p.pcm_s16le==='string' && p.pcm_s16le.length<=32000 &&
    p.pcm_s16le.length%4===0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(p.pcm_s16le) &&
    (!p.pcm_s16le || (p.active && p.generation>0 && p.sequence>0));
}
export function speakerFrames(p) {
  if(!validSpeakerPacket(p))return -1;
  const bytes=p.pcm_s16le.length/4*3-(p.pcm_s16le.endsWith('==')?2:p.pcm_s16le.endsWith('=')?1:0);
  return bytes%2 || bytes/2>Math.floor(p.sample_rate/4) || p.first_frame+bytes/2>p.total_frames ? -1:bytes/2;
}
