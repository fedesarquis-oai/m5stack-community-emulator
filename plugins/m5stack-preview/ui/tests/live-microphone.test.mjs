import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {LiveMicrophone} from '../live-microphone.mjs';
import {installLiveMicrophoneProcessor, LIVE_MICROPHONE_WORKLET_SOURCE} from '../live-microphone-processor.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; };
async function settle() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
// Unit-only synthetic environment. No browser API is patched in a real host.
function fixture(options = {}) {
  let time = 1000, nativeSequence = -1, nativeFrame = 0;
  const contexts = [], nodes = [], streams = [], requests = [], calls = [], states = [], levels = [], diagnostics = [], timers = new Map(), revoked = [], urls = [];
  const docEvents = new Map(), winEvents = new Map();
  const document = {hidden: false, visibilityState: 'visible', addEventListener: (name, fn) => docEvents.set(name, fn), removeEventListener: name => docEvents.delete(name)};
  const makeStream = () => {
    const listeners = new Set();
    const track = {kind: 'audio', readyState: 'live', stops: 0, getSettings: () => ({channelCount: options.channels ?? 2, ...options.settings}),
      addEventListener: (_name, fn) => listeners.add(fn), removeEventListener: (_name, fn) => listeners.delete(fn),
      stop() { this.stops++; this.readyState = 'ended'; }, end() { this.readyState = 'ended'; for (const fn of [...listeners]) fn(); }};
    const stream = {track, getAudioTracks: () => [track], getTracks: () => [track]}; streams.push(stream); return stream;
  };
  class Context {
    constructor(config) {
      if (options.contextError) throw options.contextError;
      this.config = config; this.sampleRate = options.rate ?? 16000; this.state = 'suspended'; this.closes = 0; this.resumes = 0; this.sources = [];
      this.audioWorklet = {addModule: url => { this.module = url; if (options.moduleThrow) throw options.moduleThrow; return options.module?.promise ?? Promise.resolve(); }};
      contexts.push(this);
    }
    resume() { this.resumes++; return (options.resume?.promise ?? Promise.resolve()).then(() => { if (this.state !== 'closed') this.state = 'running'; }); }
    close() { this.closes++; this.state = 'closed'; return Promise.resolve(); }
    createMediaStreamSource(stream) {
      if (options.sourceError) throw options.sourceError;
      const source = {stream, disconnects: 0, connect(node) { if (options.connectError) throw options.connectError; this.node = node; }, disconnect() { this.disconnects++; }};
      this.sources.push(source); return source;
    }
  }
  class Node {
    constructor(context, name, config) {
      if (options.nodeError) throw options.nodeError;
      assert.equal(name, 'm5stack-live-pcm16-v1'); this.config = config; this.sent = []; this.disconnects = 0;
      this.port = {onmessage: null, closed: false, postMessage: data => this.processor.port.onmessage({data}), close: () => { this.port.closed = true; }};
      const owner = this; let Processor;
      installLiveMicrophoneProcessor({sampleRate: context.sampleRate, registerProcessor(_name, value) { Processor = value; }, AudioWorkletProcessor: class {
        constructor() { this.port = {onmessage: null, postMessage(data, transfer) {
          const copy = structuredClone(data, transfer ? {transfer} : undefined); owner.sent.push(copy);
          queueMicrotask(() => owner.port.onmessage?.({data: copy}));
        }}; }
      }});
      this.processor = new Processor(); nodes.push(this);
    }
    disconnect() { this.disconnects++; }
    feed(samples = new Float32Array(1600).fill(.25)) { return this.processor.process([[samples]], []); }
    feedStereo(left, right) {
      assert.equal(this.config.channelCountMode, 'explicit'); assert.equal(this.config.channelCount, 1); assert.equal(this.config.channelInterpretation, 'speakers');
      return this.feed(Float32Array.from(left, (sample, i) => (sample + right[i]) / 2));
    }
    inject(data) { this.port.onmessage?.({data}); }
  }
  const window = {AudioContext: Context, AudioWorkletNode: Node, Blob, isSecureContext: true, crypto: webcrypto,
    btoa: value => Buffer.from(value, 'binary').toString('base64'), performance: {now: () => time},
    navigator: {mediaDevices: {getUserMedia(constraints) { requests.push(constraints); return options.permission?.promise ?? Promise.resolve(makeStream()); }}},
    URL: {createObjectURL: blob => { const url = 'blob:fixture_' + urls.length; urls.push({url, blob}); return url; }, revokeObjectURL: url => revoked.push(url)},
    setInterval(fn) { const id = {}; timers.set(id, fn); return id; }, clearInterval(id) { timers.delete(id); },
    addEventListener: (name, fn) => winEvents.set(name, fn), removeEventListener: name => winEvents.delete(name),
  };
  const ack = payload => {
    if (payload.action === 'start') { nativeSequence = -1; nativeFrame = 0; }
    if (payload.action === 'chunk') { nativeSequence = payload.sequence; nativeFrame = payload.firstFrame + Buffer.from(payload.pcmBase64, 'base64').length / 2; }
    return {structuredContent: {sessionId: payload.sessionId, streamId: payload.streamId, action: payload.action, accepted: true,
      sequence: nativeSequence, nextFrame: nativeFrame, requested: true, active: payload.action !== 'stop',
      ...(options.revision !== undefined ? {revision: options.revision} : {})}};
  };
  const call = (name, payload) => {
    assert.equal(name, 'm5stack_audio'); const entry = {name, payload, ack: () => ack(payload)}; calls.push(entry);
    return options.call ? options.call(entry, calls.length - 1) : Promise.resolve(entry.ack());
  };
  const microphone = new LiveMicrophone({window, document, call, onState: value => states.push(value), onLevel: value => levels.push(value), onDiagnostic: value => diagnostics.push(value)});
  return {microphone, window, document, contexts, nodes, streams, requests, calls, states, levels, diagnostics, timers, revoked, urls, makeStream,
    async enable(requested = true) { const result = microphone.enable({sessionId: 'session-a', requested}); await settle(); await result; await settle(); return result; },
    advance(ms, tick = true) { time += ms; if (tick) for (const fn of [...timers.values()]) fn(); },
    hide() { document.hidden = true; document.visibilityState = 'hidden'; docEvents.get('visibilitychange')?.(); },
    pagehide() { winEvents.get('pagehide')?.(); },
    show() { document.hidden = false; document.visibilityState = 'visible'; docEvents.get('visibilitychange')?.(); },
    async close() { microphone.dispose(); await settle(); },
  };
}
function released(h) {
  assert.ok(h.streams.every(stream => stream.track.stops >= 1));
  assert.ok(h.nodes.every(node => node.port.closed && node.disconnects === 1));
  assert.ok(h.contexts.every(context => context.closes === 1));
  assert.equal(h.timers.size, 0); assert.deepEqual(h.revoked.sort(), h.urls.map(({url}) => url).sort());
}

test('Enable prepares synchronously in the gesture and waits for app opt-in before acquiring media', async () => {
  const h = fixture(), pending = h.microphone.enable({sessionId: 'session-a', requested: false});
  assert.equal(h.contexts[0].resumes, 1); assert.equal(h.requests.length, 0);
  assert.equal(await h.urls[0].blob.text(), LIVE_MICROPHONE_WORKLET_SOURCE); await pending;
  assert.equal(h.microphone.state.status, 'armed'); assert.equal(h.calls.length, 0);
  h.microphone.setRequest(true); await settle(); assert.equal(h.requests.length, 1); assert.equal(h.calls[0].payload.source, 'browser');
  await h.close(); released(h);
});
test('explicit mono graph streams ordered PCM16LE chunks and accepts metadata-only acknowledgments', async () => {
  const h = fixture(); await h.enable(); const node = h.nodes[0];
  assert.deepEqual(node.config, {numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers'});
  const left = new Float32Array(1600).fill(.5), right = new Float32Array(1600).fill(-.25);
  node.feedStereo(left, right); await settle(); node.feed(); await settle();
  const chunks = h.calls.filter(entry => entry.payload.action === 'chunk'); assert.equal(chunks.length, 2);
  assert.deepEqual(chunks.map(({payload}) => [payload.sequence, payload.firstFrame]), [[0, 0], [1, 1600]]);
  const bytes = Buffer.from(chunks[0].payload.pcmBase64, 'base64'); assert.equal(bytes.length, 3200); assert.equal(bytes.readInt16LE(0), 4096);
  assert.equal(h.microphone.state.receivedFrames, 3200); assert.equal(h.microphone.state.status, 'active');
  assert.ok(h.levels.includes(.125)); assert.ok(node.sent.filter(value => value.samples).every(value => new Uint8Array(value.samples).every(byte => byte === 0)));
  await h.close(); released(h);
});
test('capture requests unprocessed input and diagnostics report only safe effective settings', async () => {
  const h = fixture({settings: {echoCancellation: true, noiseSuppression: false, autoGainControl: false, deviceId: 'private-device'}}); await h.enable();
  assert.deepEqual(h.requests[0].audio, {channelCount: {ideal: 1}, sampleRate: {ideal: 16000}, echoCancellation: false, noiseSuppression: false, autoGainControl: false});
  const settings = h.microphone.diagnostics.find(value => value.stage === 'stream');
  assert.equal(settings.echoCancellation, true); assert.equal(settings.noiseSuppression, false); assert.equal(settings.autoGainControl, false);
  assert.ok(!JSON.stringify(h.microphone.diagnostics).includes('private-device')); await h.close(); released(h);
});
test('only one audio call is in flight and two waiting chunks retain ordering', async () => {
  const gate = deferred(); let held;
  const h = fixture({call(entry) { if (entry.payload.action === 'chunk' && entry.payload.sequence === 0) { held = entry; return gate.promise; } return entry.ack(); }});
  await h.enable(); h.nodes[0].feed(); h.nodes[0].feed(); h.nodes[0].feed(); await settle();
  assert.equal(h.calls.length, 2); assert.equal(h.microphone.state.armed, true);
  gate.resolve(held.ack()); await settle();
  assert.deepEqual(h.calls.filter(entry => entry.payload.action === 'chunk').map(entry => entry.payload.sequence), [0, 1, 2]);
  assert.equal(h.microphone.state.receivedFrames, 4800); await h.close(); released(h);
});
test('a 600 ms acknowledgment stall drains exact PCM in order without losing input', async () => {
  const gate = deferred(); let held;
  const h = fixture({call(entry) { if (entry.payload.action === 'chunk' && entry.payload.sequence === 0) { held = entry; return gate.promise; } return entry.ack(); }});
  await h.enable();
  for (let i = 0; i < 6; i++) { h.nodes[0].feed(new Float32Array(1600).fill((i + 1) / 10)); h.advance(100); await settle(); }
  assert.equal(h.microphone.state.status, 'active');
  assert.equal(h.calls.filter(entry => entry.payload.action === 'chunk').length, 1);
  gate.resolve(held.ack()); await settle();
  const chunks = h.calls.filter(entry => entry.payload.action === 'chunk');
  assert.deepEqual(chunks.map(({payload}) => [payload.sequence, payload.firstFrame]), Array.from({length: 6}, (_, i) => [i, i * 1600]));
  for (let i = 0; i < chunks.length; i++) {
    const pcm = Buffer.from(chunks[i].payload.pcmBase64, 'base64');
    for (let offset = 0; offset < pcm.length; offset += 2) assert.equal(pcm.readInt16LE(offset), Math.round(Math.fround((i + 1) / 10) * 32767));
  }
  assert.equal(h.microphone.state.receivedFrames, 9600);
  h.nodes[0].feed(); await settle(); assert.equal(h.microphone.state.receivedFrames, 11200);
  await h.close(); released(h);
});
test('an eleventh unacknowledged chunk fails boundedly instead of silently dropping audio', async () => {
  const gate = deferred(); let held;
  const h = fixture({call(entry) { if (entry.payload.action === 'chunk') { held = entry; return gate.promise; } return entry.ack(); }});
  await h.enable(); for (let i = 0; i < 11; i++) h.nodes[0].feed(); await settle();
  assert.equal(h.microphone.state.errorCode, 'LIVE_OVERRUN'); assert.equal(h.microphone.state.armed, false);
  assert.equal(h.calls.filter(entry => entry.payload.action === 'chunk').length, 1);
  assert.equal(h.streams[0].track.stops, 1); gate.resolve(held.ack()); await settle();
  assert.equal(h.calls.at(-1).payload.action, 'stop'); await h.close(); released(h);
});
test('Disable clears queued PCM immediately and sends stop only after the in-flight chunk', async () => {
  const gate = deferred(); let held;
  const h = fixture({call(entry) { if (entry.payload.action === 'chunk') { held = entry; return gate.promise; } return entry.ack(); }});
  await h.enable(); for (let i = 0; i < 3; i++) h.nodes[0].feed(); await settle();
  h.microphone.disable(); assert.equal(h.streams[0].track.stops, 1); assert.equal(h.calls.length, 2);
  assert.ok(h.nodes[0].sent.filter(value => value.samples).every(value => new Uint8Array(value.samples).every(byte => byte === 0)));
  gate.resolve(held.ack()); await settle(); assert.deepEqual(h.calls.map(entry => entry.payload.action), ['start', 'chunk', 'stop']);
  assert.equal(h.microphone.state.status, 'off'); released(h);
});
test('Disable during a delayed native start stops the late stream and never constructs an audio graph', async () => {
  const gate = deferred(); let held;
  const h = fixture({call(entry) { if (entry.payload.action === 'start') { held = entry; return gate.promise; } return entry.ack(); }});
  await h.enable(); h.microphone.disable(); assert.equal(h.nodes.length, 0); gate.resolve(held.ack()); await settle();
  assert.deepEqual(h.calls.map(entry => entry.payload.action), ['start', 'stop']); assert.equal(h.nodes.length, 0); released(h);
});
test('late microphone grant after Disable is released without native calls', async () => {
  const permission = deferred(), h = fixture({permission}); await h.enable(); h.microphone.disable();
  const stream = h.makeStream(); permission.resolve(stream); await settle(); assert.equal(stream.track.stops, 1); assert.equal(h.calls.length, 0); released(h);
});
test('app request changes cannot accumulate simultaneous microphone permission requests', async () => {
  const permission = deferred(), h = fixture({permission}); await h.enable();
  for (let i = 0; i < 8; i++) { h.microphone.setRequest(false); h.microphone.setRequest(true); }
  assert.equal(h.requests.length, 1); h.microphone.disable();
  const stream = h.makeStream(); permission.resolve(stream); await settle(); assert.equal(stream.track.stops, 1); released(h);
});
test('app withdrawal stops tracks but preserves the armed session for a later request', async () => {
  const h = fixture(); await h.enable(); h.nodes[0].feed(); await settle(); h.microphone.setRequest(false); await settle();
  assert.equal(h.microphone.state.armed, true); assert.equal(h.microphone.state.status, 'armed'); assert.equal(h.streams[0].track.stops, 1);
  assert.equal(h.contexts[0].closes, 0); h.microphone.setRequest(true); await settle();
  assert.equal(h.requests.length, 2); assert.equal(h.contexts.length, 1);
  assert.notEqual(h.calls[0].payload.streamId, h.calls.at(-1).payload.streamId); await h.close(); released(h);
});
for (const accepted of [false, true]) test('native app withdrawal accepted=' + accepted + ' pauses without reporting an audio failure', async () => {
  const h = fixture({call(entry) {
    if (entry.payload.action !== 'chunk') {
      const result = entry.ack();
      if (!accepted && entry.payload.action === 'stop') Object.assign(result.structuredContent, {sequence: -1, nextFrame: 0});
      return result;
    }
    const ack = accepted ? entry.ack().structuredContent : {...entry.ack().structuredContent, sequence: -1, nextFrame: 0};
    return {structuredContent: {...ack, accepted, requested: false, active: false}};
  }});
  await h.enable(); h.nodes[0].feed(); await settle();
  assert.equal(h.microphone.state.armed, true); assert.equal(h.microphone.state.requested, false); assert.equal(h.microphone.state.error, null);
  assert.equal(h.microphone.state.receivedFrames, accepted ? 1600 : 0); assert.equal(h.streams[0].track.stops, 1); await h.close(); released(h);
});
test('final native acknowledgment cannot be undone by stale requested frames', async () => {
  const h = fixture({call(entry) {
    const result = entry.ack();
    if (entry.payload.action === 'chunk') Object.assign(result.structuredContent, {requested: false, active: false});
    return result;
  }});
  await h.enable(); h.nodes[0].feed(); await settle();
  assert.equal(h.microphone.state.requested, false); assert.equal(h.microphone.state.receivedFrames, 1600);
  for (let i = 0; i < 3; i++) { h.microphone.setRequest(true); await settle(); }
  assert.equal(h.requests.length, 1, 'old polled demand must not reacquire the microphone');
  assert.equal(h.microphone.state.receivedFrames, 1600, 'completed sample evidence must not reset');
  h.microphone.setRequest(false); h.microphone.setRequest(true); await settle();
  assert.equal(h.requests.length, 2, 'a new app demand edge remains supported while armed');
  await h.close(); released(h);
});
test('revision fence allows a fresh app request without a false frame and rejects older snapshots', async () => {
  const h = fixture({revision: 10, call(entry) {
    const result = entry.ack();
    if (entry.payload.action === 'chunk') Object.assign(result.structuredContent, {requested: false, active: false});
    return result;
  }});
  await h.enable(); h.microphone.setRequest(true, 10); h.nodes[0].feed(); await settle();
  h.microphone.setRequest(false, 10); h.microphone.setRequest(true, 10); await settle(); assert.equal(h.requests.length, 1);
  h.microphone.setRequest(true, 11); await settle(); assert.equal(h.requests.length, 2);
  assert.equal(h.microphone.setRequest(false, 10), false); assert.equal(h.microphone.state.requested, true);
  await h.close(); released(h);
});
for (const fresh of [false, true]) test('withdrawal acknowledgment ordered against an already received ' + (fresh ? 'newer' : 'older') + ' input response', async () => {
  const gate = deferred(); let held;
  const h = fixture({revision: 10, call(entry) {
    if (entry.payload.action === 'chunk') { held = entry; return gate.promise; }
    return entry.ack();
  }});
  await h.enable(); h.nodes[0].feed(); await settle();
  h.microphone.setRequest(true, fresh ? 11 : 9);
  const result = held.ack(); Object.assign(result.structuredContent, {requested: false, active: false}); gate.resolve(result); await settle();
  assert.equal(h.requests.length, fresh ? 2 : 1);
  assert.equal(h.microphone.state.requested, fresh);
  await h.close(); released(h);
});
test('newer withdrawal acknowledgment cancels stale demand even after local run cleanup began', async () => {
  const gate = deferred(); let held;
  const h = fixture({revision: 10, call(entry) {
    if (entry.payload.action === 'chunk') { held = entry; return gate.promise; }
    return entry.ack();
  }});
  await h.enable(); h.nodes[0].feed(); await settle();
  h.microphone.setRequest(false, 8); h.microphone.setRequest(true, 9);
  const result = held.ack(); Object.assign(result.structuredContent, {requested: false, active: false}); gate.resolve(result); await settle();
  assert.equal(h.requests.length, 1); assert.equal(h.microphone.state.requested, false);
  h.microphone.setRequest(true, 11); await settle(); assert.equal(h.requests.length, 2);
  await h.close(); released(h);
});
test('cleanup acknowledgment cannot revive an app that withdrew demand after its last frame', async () => {
  const h = fixture({revision: 10, call(entry) {
    const result = entry.ack();
    if (entry.payload.action === 'stop') Object.assign(result.structuredContent, {revision: 12, requested: false});
    return result;
  }});
  await h.enable(); h.nodes[0].feed(); await settle();
  h.microphone.setRequest(false, 10); h.microphone.setRequest(true, 11); await settle();
  assert.equal(h.requests.length, 1); assert.equal(h.microphone.state.requested, false);
  h.microphone.setRequest(true, 13); await settle(); assert.equal(h.requests.length, 2);
  await h.close(); released(h);
});
test('invalid cleanup acknowledgment disarms instead of allowing a queued restart', async () => {
  const h = fixture({revision: 10, call(entry) {
    const result = entry.ack();
    if (entry.payload.action === 'stop') result.structuredContent.revision = -1;
    return result;
  }});
  await h.enable(); h.nodes[0].feed(); await settle();
  h.microphone.setRequest(false, 10); h.microphone.setRequest(true, 11); await settle();
  assert.equal(h.microphone.state.errorCode, 'LIVE_TRANSPORT'); assert.equal(h.microphone.state.armed, false);
  assert.equal(h.requests.length, 1); await h.close(); released(h);
});
for (const revision of [null, -1, 1.5, NaN, Infinity, '10', Number.MAX_SAFE_INTEGER + 1]) test('malformed acknowledgment revision ' + revision + ' fails closed', async () => {
  const h = fixture({revision}); await h.enable(); await settle();
  assert.equal(h.microphone.state.errorCode, 'LIVE_TRANSPORT'); assert.equal(h.nodes.length, 0);
  await h.close(); released(h);
});
for (const boundary of ['hide', 'pagehide', 'track']) test(boundary + ' disarms and does not automatically restart', async () => {
  const h = fixture(); await h.enable();
  if (boundary === 'track') h.streams[0].track.end(); else h[boundary]();
  await settle(); h.show(); h.microphone.setRequest(true); await settle(); assert.equal(h.microphone.state.armed, false); assert.equal(h.requests.length, 1); released(h);
});
for (const [name, code] of [['NotAllowedError', 'LIVE_PERMISSION'], ['NotReadableError', 'LIVE_DEVICE'], ['NotFoundError', 'LIVE_NO_DEVICE']]) test(name + ' reports a fixed error without raw host text', async () => {
  const permission = deferred(), h = fixture({permission}); await h.enable(); permission.reject(new DOMException('private device label and host information', name)); await settle();
  assert.equal(h.microphone.state.errorCode, code); assert.ok(!JSON.stringify({states: h.states, diagnostics: h.diagnostics}).includes('private'));
  assert.equal(h.microphone.diagnostics.find(item => item.stage === 'microphone-access').errorName, name); released(h);
});
test('permission denial stays disarmed until an explicit retry and then accepts a new stream', async () => {
  const permission = deferred(), options = {permission}, h = fixture(options); await h.enable();
  permission.reject(new DOMException('Private permission detail', 'NotAllowedError')); await settle();
  h.microphone.setRequest(false); h.microphone.setRequest(true); await settle();
  assert.equal(h.requests.length, 1); assert.equal(h.microphone.state.armed, false);
  options.permission = null; await h.enable(); h.nodes[0].feed(); await settle();
  assert.equal(h.requests.length, 2); assert.equal(h.microphone.state.status, 'active');
  assert.equal(h.microphone.state.error, null); assert.equal(h.microphone.state.receivedFrames, 1600);
  await h.close(); released(h);
});
for (const boundary of ['hide', 'track', 'context', 'stop']) test(boundary + ' recovery needs explicit enable and starts with clean PCM counters', async () => {
  const h = fixture(); await h.enable(); h.nodes[0].feed(); await settle();
  if (boundary === 'hide') h.hide();
  else if (boundary === 'track') h.streams[0].track.end();
  else if (boundary === 'context') { h.contexts[0].state = 'interrupted'; h.contexts[0].onstatechange(); }
  else h.microphone.disable('stopped');
  await settle(); h.show(); h.microphone.setRequest(false); h.microphone.setRequest(true); await settle();
  assert.equal(h.requests.length, 1); assert.equal(h.microphone.state.armed, false);
  assert.ok(h.streams[0].track.stops > 0); assert.equal(h.contexts[0].closes, 1);
  await h.enable(); h.nodes[1].feed(); await settle();
  const starts = h.calls.filter(entry => entry.payload.action === 'start');
  const chunks = h.calls.filter(entry => entry.payload.action === 'chunk');
  assert.equal(h.requests.length, 2); assert.notEqual(starts[0].payload.streamId, starts[1].payload.streamId);
  assert.deepEqual(chunks.map(entry => [entry.payload.sequence, entry.payload.firstFrame]), [[0, 0], [0, 0]]);
  assert.equal(h.microphone.state.receivedFrames, 1600); assert.equal(h.microphone.state.error, null);
  await h.close(); released(h);
});
test('sustained capture preserves all ordered PCM until the five-minute deadline and retries explicitly', async () => {
  const h = fixture(); await h.enable();
  for (let i = 0; i < 2999; i++) { h.nodes[0].feed(); await settle(); h.advance(100); }
  const chunks = h.calls.filter(entry => entry.payload.action === 'chunk');
  assert.equal(chunks.length, 2999); assert.equal(h.microphone.state.receivedFrames, 4798400);
  for (let i = 0; i < chunks.length; i++) {
    assert.equal(chunks[i].payload.sequence, i); assert.equal(chunks[i].payload.firstFrame, i * 1600);
    assert.equal(Buffer.from(chunks[i].payload.pcmBase64, 'base64').length, 3200);
  }
  h.advance(100); await settle();
  assert.equal(h.microphone.state.errorCode, 'LIVE_LIMIT'); assert.equal(h.streams[0].track.stops, 1);
  h.microphone.setRequest(false); h.microphone.setRequest(true); await settle(); assert.equal(h.requests.length, 1);
  await h.enable(); h.nodes[1].feed(); await settle();
  assert.equal(h.requests.length, 2); assert.equal(h.microphone.state.receivedFrames, 1600);
  assert.equal(h.calls.at(-1).payload.firstFrame, 0); await h.close(); released(h);
});
test('processor channel errors retain the fixed stage reason and never include audio', async () => {
  const h = fixture(); await h.enable(); h.nodes[0].processor.process([[new Float32Array(128), new Float32Array(128)]], []); await settle();
  assert.equal(h.microphone.state.errorCode, 'LIVE_PROCESSOR'); assert.equal(h.microphone.diagnostics.find(item => item.stage === 'processor').processorReason, 'INVALID_CHANNELS'); released(h);
});
for (const [change, value] of [['sequence', 3], ['firstFrame', 2], ['sampleRate', 48000], ['frames', 1601]]) test('rejects malformed processor ' + change + ' and scrubs transferred bytes', async () => {
  const h = fixture(); await h.enable(); h.nodes[0].feed(new Float32Array(128)); await settle();
  const samples = new ArrayBuffer(3200); new Uint8Array(samples).fill(99);
  h.nodes[0].inject({type: 'chunk', sampleRate: 16000, frames: 1600, sequence: 0, firstFrame: 0, samples, level: .5, [change]: value}); await settle();
  assert.equal(h.microphone.state.errorCode, 'LIVE_DATA'); assert.ok(new Uint8Array(samples).every(value => value === 0)); released(h);
});
test('wrong or stale native acknowledgment cannot advance audio or start processing', async () => {
  const h = fixture({call: entry => ({structuredContent: {...entry.ack().structuredContent, streamId: 'stale'}})}); await h.enable(); await settle();
  assert.equal(h.microphone.state.errorCode, 'LIVE_TRANSPORT'); assert.equal(h.nodes.length, 0); released(h);
});
test('transport timeout disarms; late acknowledgment only enables cleanup, never another chunk', async () => {
  const gate = deferred(); let held;
  const h = fixture({call(entry) { if (entry.payload.action === 'chunk') { held = entry; return gate.promise; } return entry.ack(); }});
  await h.enable(); h.nodes[0].feed(); await settle(); h.advance(5000);
  assert.equal(h.microphone.state.errorCode, 'LIVE_TIMEOUT'); gate.resolve(held.ack()); await settle();
  assert.equal(h.calls.at(-1).payload.action, 'stop'); assert.equal(h.microphone.state.armed, false); released(h);
});
test('a late response cannot bypass the transport deadline when timer callbacks have not run', async () => {
  const gate = deferred(); let held;
  const h = fixture({call(entry) { if (entry.payload.action === 'start') { held = entry; return gate.promise; } return entry.ack(); }});
  await h.enable(); h.advance(5000, false); gate.resolve(held.ack()); await settle();
  assert.equal(h.microphone.state.errorCode, 'LIVE_TIMEOUT'); assert.equal(h.nodes.length, 0);
  assert.deepEqual(h.calls.map(entry => entry.payload.action), ['start', 'stop']); released(h);
});
test('a stalled processor cannot resume after its deadline without a fresh Enable', async () => {
  const h = fixture(); await h.enable(); h.nodes[0].feed(); await settle(); h.advance(5000, false); h.nodes[0].feed(); await settle();
  assert.equal(h.microphone.state.errorCode, 'LIVE_TIMEOUT'); assert.equal(h.calls.filter(entry => entry.payload.action === 'chunk').length, 1); released(h);
});
test('request withdrawal and reactivation wait for the previous transport to stop', async () => {
  const gate = deferred(); let held;
  const h = fixture({call(entry) { if (entry.payload.action === 'chunk') { held = entry; return gate.promise; } return entry.ack(); }});
  await h.enable(); h.nodes[0].feed(); await settle(); h.microphone.setRequest(false); h.microphone.setRequest(true); await settle();
  assert.equal(h.requests.length, 1); assert.equal(h.calls.length, 2);
  gate.resolve(held.ack()); await settle();
  assert.deepEqual(h.calls.map(entry => entry.payload.action), ['start', 'chunk', 'stop', 'start']);
  assert.equal(h.requests.length, 2); await h.close(); released(h);
});
test('permission timeout releases a later grant and cannot restart', async () => {
  const permission = deferred(), h = fixture({permission}); await h.enable(); h.advance(30000);
  assert.equal(h.microphone.state.errorCode, 'LIVE_TIMEOUT'); const stream = h.makeStream(); permission.resolve(stream); await settle();
  assert.match(h.microphone.state.error,/permission.*tab active/);
  assert.equal(stream.track.stops, 1); assert.equal(h.calls.length, 0); released(h);
});
test('five-minute armed deadline applies while the app is not requesting input', async () => {
  const h = fixture(); await h.enable(false); h.advance(300000); assert.equal(h.microphone.state.errorCode, 'LIVE_LIMIT'); h.microphone.setRequest(true);
  assert.equal(h.requests.length, 0); released(h);
});
for (const kind of ['resume', 'module']) test('Disable during pending ' + kind + ' fences late setup completion', async () => {
  const gate = deferred(), h = fixture({[kind]: gate}); const result = h.microphone.enable({sessionId: 'session-a', requested: true}); h.microphone.disable(); gate.resolve();
  assert.equal(await result, false); await settle(); assert.equal(h.requests.length, 0); released(h);
});
test('Disable settles Enable even when the host never resolves audio preparation', async () => {
  const h = fixture({resume: deferred()}), result = h.microphone.enable({sessionId: 'session-a', requested: true});
  h.microphone.disable(); assert.equal(await result, false); assert.equal(h.requests.length, 0); released(h);
});
test('preparation watchdog settles Enable even when module loading never resolves', async () => {
  const h = fixture({module: deferred()}), result = h.microphone.enable({sessionId: 'session-a', requested: true});
  h.advance(10000); assert.equal(await result, false); assert.equal(h.microphone.state.errorCode, 'LIVE_TIMEOUT'); released(h);
});
test('setup rejection sanitizes errors and releases the context', async () => {
  const gate = deferred(), h = fixture({module: gate}); const result = h.microphone.enable({sessionId: 'session-a', requested: true}); gate.reject(new DOMException('private CSP detail', 'SecurityError'));
  assert.equal(await result, false); assert.equal(h.microphone.state.errorCode, 'LIVE_MODULE'); assert.ok(!JSON.stringify(h.microphone.diagnostics).includes('private')); released(h);
});
test('unsupported context rate fails before acquiring microphone input', async () => {
  const h = fixture({rate: 48000}); assert.equal(await h.enable(), false); assert.equal(h.microphone.state.errorCode, 'LIVE_RATE'); assert.equal(h.requests.length, 0); released(h);
});
