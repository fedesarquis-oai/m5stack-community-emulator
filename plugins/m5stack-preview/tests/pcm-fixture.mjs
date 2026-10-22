// Independent canonical WAV fixture writer. No media, network or production encoder.
export function pcmFixture({size=32044,sampleRate=16000}={}){
  if(size<46||(size-44)%2)throw new Error('Invalid fixture size');
  const audio=Buffer.alloc(size,0x29);
  audio.write('RIFF',0);audio.writeUInt32LE(size-8,4);audio.write('WAVE',8);
  audio.write('fmt ',12);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);
  audio.writeUInt32LE(sampleRate,24);audio.writeUInt32LE(sampleRate*2,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);
  audio.write('data',36);audio.writeUInt32LE(size-44,40);return audio;
}
