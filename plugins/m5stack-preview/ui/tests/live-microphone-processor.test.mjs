import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {installLiveMicrophoneProcessor, LIVE_MICROPHONE_WORKLET_SOURCE} from '../live-microphone-processor.mjs';

function fixture(rate = 16000) {
  const messages = []; let Processor;
  const scope = {sampleRate: rate, registerProcessor(name, value) { assert.equal(name, 'm5stack-live-pcm16-v1'); Processor = value; }, AudioWorkletProcessor: class {
    constructor() { this.port = {onmessage: null, postMessage(value, transfer) { messages.push(structuredClone(value, transfer ? {transfer} : undefined)); }}; }
  }};
  installLiveMicrophoneProcessor(scope); const processor = new Processor();
  return {processor, messages, command: data => processor.port.onmessage({data}), feed: samples => processor.process([[samples]], [])};
}
test('worklet source is self-contained and registers without imported helpers', () => {
  let registered = false;
  vm.runInNewContext(LIVE_MICROPHONE_WORKLET_SOURCE, {sampleRate: 16000, AudioWorkletProcessor: class {}, registerProcessor(name) { registered = name === 'm5stack-live-pcm16-v1'; }});
  assert.equal(registered, true);
});
test('render quanta straddling chunk boundaries produce exact contiguous PCM16LE', () => {
  const h = fixture(); h.command({type: 'begin'});
  for (let i = 0; i < 25; i++) h.feed(new Float32Array(128).fill(i % 2 ? -.5 : .5));
  const chunks = h.messages.filter(item => item.type === 'chunk'); assert.equal(chunks.length, 2);
  assert.deepEqual(chunks.map(item => [item.sequence, item.firstFrame, item.frames]), [[0, 0, 1600], [1, 1600, 1600]]);
  assert.equal(new DataView(chunks[0].samples).getInt16(0, true), 16384);
  assert.equal(new DataView(chunks[0].samples).getInt16(128 * 2, true), -16384);
  assert.equal(chunks[0].level, .5); assert.equal(h.processor.used, 0); assert.equal(h.processor.buffer, null);
});
test('ten credits bound transferred audio even while the UI message queue is blocked', () => {
  const h = fixture(); h.command({type: 'begin'});
  for (let i = 0; i < 11; i++) h.feed(new Float32Array(1600));
  assert.equal(h.messages.filter(item => item.type === 'chunk').length, 10); assert.equal(h.messages.at(-1).code, 'OVERRUN'); assert.equal(h.processor.buffer, null);
});
test('ordered acknowledgments restore credits and never reorder chunks', () => {
  const h = fixture(); h.command({type: 'begin'});
  for (let i = 0; i < 8; i++) { h.feed(new Float32Array(1600)); h.command({type: 'ack', sequence: i}); }
  assert.equal(h.messages.filter(item => item.type === 'chunk').length, 8); assert.equal(h.processor.credits, 10);
  h.command({type: 'ack', sequence: 7}); assert.equal(h.messages.at(-1).code, 'INVALID_COMMAND');
});
test('cancel scrubs partial samples and never flushes audio after consent ends', () => {
  const h = fixture(); h.command({type: 'begin'}); h.feed(new Float32Array(128).fill(.7)); const bytes = new Uint8Array(h.processor.buffer);
  h.command({type: 'cancel'}); assert.ok(bytes.every(byte => byte === 0)); assert.equal(h.feed(new Float32Array(1600)), false);
  assert.equal(h.messages.filter(item => item.type === 'chunk').length, 0);
});
test('nonfinite samples are rejected before any sample in that block is accepted', () => {
  const h = fixture(); h.command({type: 'begin'}); const samples = new Float32Array(1600).fill(.5); samples[1599] = NaN;
  assert.equal(h.feed(samples), false); assert.equal(h.messages.at(-1).code, 'NONFINITE_SAMPLE'); assert.equal(h.processor.frames, 0);
});
test('unexpected stereo at the strict mono processor is diagnosed, rather than dropping a channel', () => {
  const h = fixture(); h.command({type: 'begin'}); h.processor.process([[new Float32Array(128), new Float32Array(128)]], []);
  assert.equal(h.messages.at(-1).code, 'INVALID_CHANNELS');
});
test('every render branch leaves any supplied output silent', () => {
  const h = fixture(), output = new Float32Array(128).fill(1); h.processor.process([], [[output]]); assert.ok(output.every(value => value === 0));
  h.command({type: 'begin'}); output.fill(1); h.processor.process([[new Float32Array(128)]], [[output]]); assert.ok(output.every(value => value === 0));
  h.command({type: 'cancel'}); output.fill(1); h.processor.process([], [[output]]); assert.ok(output.every(value => value === 0));
});
test('five minutes of samples terminates without allocating a whole-session recording', () => {
  const h = fixture(); h.command({type: 'begin'}); const block = new Float32Array(1600);
  for (let i = 0; i < 3000; i++) { h.feed(block); if (i < 2999) h.command({type: 'ack', sequence: i}); }
  assert.equal(h.processor.frames, 4800000); assert.equal(h.processor.phase, 'complete'); assert.equal(h.processor.buffer, null); assert.equal(h.messages.at(-1).type, 'limit');
});

test('shipped live worklet remains self-contained and produces exact PCM after bundling',async()=>{
  const html=await readFile(new URL('../dist/workbench.html',import.meta.url),'utf8');
  const begin=html.indexOf('function installLiveMicrophoneProcessor('),end=html.indexOf('var LIVE_MICROPHONE_PROCESSOR_NAME',begin);
  assert(begin>=0&&end>begin,'Build the current UI before verifying the shipped worklet.');
  const compiled=html.slice(begin,end).trim();assert(compiled.endsWith('}'));
  let Processor;const messages=[];
  vm.runInNewContext('('+compiled+')(globalThis);',{sampleRate:16000,Float32Array,registerProcessor(name,value){assert.equal(name,'m5stack-live-pcm16-v1');Processor=value;},AudioWorkletProcessor:class{constructor(){this.port={onmessage:null,postMessage(value){messages.push(value);}};}}});
  const processor=new Processor();processor.port.onmessage({data:{type:'begin'}});
  const values=new Float32Array(1600);values[0]=-1;values[1599]=1;processor.process([[values]],[]);
  const chunk=messages.find(message=>message.type==='chunk');assert.equal(chunk.frames,1600);assert.equal(chunk.sequence,0);
  const pcm=new DataView(chunk.samples);assert.equal(pcm.getInt16(0,true),-32768);assert.equal(pcm.getInt16(3198,true),32767);
});
