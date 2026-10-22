import {LIVE_MICROPHONE_PROCESSOR_NAME, LIVE_MICROPHONE_WORKLET_SOURCE} from './live-microphone-processor.mjs';

const noop = () => {};
const safely = fn => { try { return fn(); } catch { return undefined; } };
const scrub = buffer => { if (buffer instanceof ArrayBuffer) safely(() => new Uint8Array(buffer).fill(0)); };
const stopStream = stream => { for (const track of safely(() => stream?.getTracks()) ?? []) safely(() => track.stop()); };
const MAX_MS = 300000, SETUP_MS = 10000, PERMISSION_MS = 30000, RESPONSE_MS = 5000;
const ERROR_TEXT = Object.freeze({
  LIVE_UNAVAILABLE: 'This host does not provide microphone audio processing.',
  LIVE_INSECURE: 'Microphone input requires a secure host context.',
  LIVE_BUSY: 'The previous microphone stream is still closing. Tap the device or press its button again shortly.',
  LIVE_SESSION: 'Select an active emulator session before enabling the microphone.',
  LIVE_CONTEXT: 'The host could not create the microphone audio context.',
  LIVE_RATE: 'The host cannot provide the required 16 kHz audio processing.',
  LIVE_RESUME: 'The host could not resume microphone audio processing from the device gesture.',
  LIVE_MODULE: 'The host could not load the bundled microphone audio processor.',
  LIVE_PERMISSION: 'Microphone access was denied by the app or system. This host may block plugin microphone input.',
  LIVE_NO_DEVICE: 'No microphone is available.',
  LIVE_DEVICE: 'The microphone is busy or unavailable.',
  LIVE_STREAM: 'The host returned an unsupported microphone stream.',
  LIVE_NODE: 'The microphone audio processor could not be created.',
  LIVE_SOURCE: 'The microphone stream could not be connected to audio processing.',
  LIVE_CONNECT: 'The microphone audio graph could not be connected.',
  LIVE_PROCESSOR: 'The microphone audio processor failed. See Media diagnostics.',
  LIVE_DATA: 'The microphone audio stream failed validation and was stopped.',
  LIVE_OVERRUN: 'The emulator could not keep up with microphone input, so capture stopped. Keep this tab active, then tap the device or press its button to retry.',
  LIVE_TIMEOUT: 'The microphone or emulator did not respond in time. Tap the device or press its button to retry.',
  LIVE_TRANSPORT: 'The emulator could not accept microphone input. Tap the device or press its button to retry.',
  LIVE_INTERRUPTED: 'Microphone input was interrupted. Tap the device or press its button to retry.',
  LIVE_LIMIT: 'The five-minute microphone session ended. Tap the device or press its button to start another session.',
  LIVE_CLOCK: 'Microphone timing could not be verified. Input was stopped.',
});
const STAGES = new Set(['context', 'resume', 'module', 'microphone-access', 'stream', 'native-start', 'worklet-node', 'media-source', 'graph-connect', 'processor', 'transport', 'lifecycle']);
const NAMES = new Set(['Error', 'TypeError', 'RangeError', 'NotAllowedError', 'SecurityError', 'InvalidStateError', 'NotSupportedError', 'AbortError', 'OperationError', 'UnknownError', 'NotFoundError', 'NotReadableError', 'OverconstrainedError']);
const REASONS = new Set(['INVALID_COMMAND', 'UNSUPPORTED_SAMPLE_RATE', 'INVALID_CHANNELS', 'INVALID_BLOCK', 'NONFINITE_SAMPLE', 'OVERRUN', 'TRANSFER_FAILED']);

/**
 * Explicit user Enable arms this visible emulator session for at most 5 minutes.
 * The app's requested flag independently gates actual capture. Input stays local
 * to call('m5stack_audio', payload); no clips, transcripts, exports, or providers.
 * Call enable directly from the click handler: context.resume runs before await.
 * disable releases local resources immediately. Native stop follows any current
 * call, so a late response cannot race a new stream. A stalled call is never
 * retried; the server's independent lease handles a client that never returns.
 */
export class LiveMicrophone {
  #window; #document; #call; #onState; #onLevel; #onDiagnostic;
  #state = {status: 'off', armed: false, requested: false, level: 0, receivedFrames: 0, error: null, errorCode: null};
  #diagnostics = []; #sessionId = null; #epoch = 0; #context = null; #moduleUrl = null; #prepared = false;
  #armedAt = 0; #lastTime; #timer = null; #run = null; #wire = null; #disposed = false; #preparationCancel = null;
  #visibility; #pagehide; #appRequested = false; #requestRevision = null; #withdrawnRevision = null;

  constructor({window = globalThis, document = window.document, call, onState = noop, onLevel = noop, onDiagnostic = noop} = {}) {
    this.#window = window; this.#document = document; this.#call = call;
    this.#onState = onState; this.#onLevel = onLevel; this.#onDiagnostic = onDiagnostic;
    this.#visibility = () => { if (this.#hidden()) this.disable('hidden'); };
    this.#pagehide = () => this.disable('pagehide');
    document?.addEventListener?.('visibilitychange', this.#visibility);
    window.addEventListener?.('pagehide', this.#pagehide);
  }
  get state() { return {...this.#state}; }
  get diagnostics() { return this.#diagnostics.map(value => ({...value})); }
  #emit() { safely(() => this.#onState(this.state)); }
  #level(value) { this.#state.level = value; safely(() => this.#onLevel(value)); }
  #hidden() { return this.#document?.hidden === true || (typeof this.#document?.visibilityState === 'string' && this.#document.visibilityState !== 'visible'); }
  #time() {
    const value = this.#window.performance?.now?.() ?? Date.now();
    if (!Number.isFinite(value) || (this.#lastTime !== undefined && value < this.#lastTime)) throw new Error('LIVE_CLOCK');
    this.#lastTime = value; return value;
  }
  #diagnose(stage, outcome, details = {}) {
    if (!STAGES.has(stage)) return;
    const entry = {stage, outcome};
    if (Object.hasOwn(ERROR_TEXT, details.errorCode)) entry.errorCode = details.errorCode;
    if (details.error) entry.errorName = NAMES.has(details.error.name) ? details.error.name : 'OtherError';
    if (REASONS.has(details.processorReason)) entry.processorReason = details.processorReason;
    if (['running', 'suspended', 'closed', 'interrupted'].includes(this.#context?.state)) entry.contextState = this.#context.state;
    if (Number.isInteger(this.#context?.sampleRate)) entry.sampleRate = this.#context.sampleRate;
    if (Number.isInteger(details.channelCount) && details.channelCount >= 0 && details.channelCount <= 32) entry.channelCount = details.channelCount;
    for (const key of ['echoCancellation', 'noiseSuppression', 'autoGainControl']) if (typeof details[key] === 'boolean') entry[key] = details[key];
    const index = this.#diagnostics.findIndex(value => value.stage === stage);
    if (index < 0) this.#diagnostics.push(entry); else this.#diagnostics[index] = entry;
    safely(() => this.#onDiagnostic({...entry}));
  }
  #current(epoch) { return !this.#disposed && this.#state.armed && this.#epoch === epoch && !this.#hidden(); }
  #live(run) { return this.#run === run && !run.ended && this.#current(run.epoch) && this.#state.requested; }

  enable({sessionId, requested} = {}) {
    if (this.#disposed) return Promise.resolve(false);
    if (this.#state.armed) return Promise.resolve(this.#sessionId === sessionId);
    if (this.#wire || this.#run) { this.#state.errorCode = 'LIVE_BUSY'; this.#state.error = ERROR_TEXT.LIVE_BUSY; this.#state.status = 'error'; this.#emit(); return Promise.resolve(false); }
    const epoch = ++this.#epoch;
    this.#lastTime = undefined; this.#diagnostics = [];
    this.#state = {status: 'preparing', armed: true, requested: requested === true, level: 0, receivedFrames: 0, error: null, errorCode: null};
    this.#sessionId = sessionId; this.#appRequested = requested === true; this.#requestRevision = null; this.#withdrawnRevision = null;
    let stage = 'context';
    try {
      if (typeof sessionId !== 'string' || !sessionId.length || sessionId.length > 256 || typeof requested !== 'boolean') throw new Error('LIVE_SESSION');
      if (this.#hidden()) throw new Error('LIVE_INTERRUPTED');
      const win = this.#window;
      if (win.isSecureContext !== true) throw new Error('LIVE_INSECURE');
      if (typeof win.AudioContext !== 'function' || typeof win.AudioWorkletNode !== 'function' ||
          typeof win.navigator?.mediaDevices?.getUserMedia !== 'function' || typeof win.URL?.createObjectURL !== 'function' ||
          typeof win.URL?.revokeObjectURL !== 'function' || typeof win.crypto?.getRandomValues !== 'function' || typeof this.#call !== 'function') throw new Error('LIVE_UNAVAILABLE');
      this.#armedAt = this.#time();
      this.#diagnose(stage, 'pending');
      try { this.#context = new win.AudioContext({sampleRate: 16000}); } catch (error) { this.#fail('LIVE_CONTEXT', stage, error); return Promise.resolve(false); }
      const context = this.#context;
      if (context.sampleRate !== 16000) throw new Error('LIVE_RATE');
      if (typeof context.audioWorklet?.addModule !== 'function' || typeof context.createMediaStreamSource !== 'function' || typeof context.close !== 'function' || typeof context.resume !== 'function') throw new Error('LIVE_UNAVAILABLE');
      this.#diagnose(stage, 'resolved');
      stage = 'resume'; this.#diagnose(stage, 'pending');
      // The first resume is in the Enable gesture's synchronous turn.
      let resume;
      try { resume = Promise.resolve(context.resume()); } catch (error) { this.#fail('LIVE_RESUME', stage, error); return Promise.resolve(false); }
      resume = resume.then(() => { if (this.#current(epoch)) this.#diagnose('resume', 'resolved'); }, error => { if (this.#current(epoch)) this.#fail('LIVE_RESUME', 'resume', error); return false; });
      stage = 'module'; this.#diagnose(stage, 'pending');
      this.#moduleUrl = win.URL.createObjectURL(new (win.Blob ?? Blob)([LIVE_MICROPHONE_WORKLET_SOURCE], {type: 'text/javascript'}));
      let loaded;
      try { loaded = Promise.resolve(context.audioWorklet.addModule(this.#moduleUrl)); } catch (error) { this.#fail('LIVE_MODULE', stage, error); return Promise.resolve(false); }
      loaded = loaded.then(() => { if (this.#current(epoch)) this.#diagnose('module', 'resolved'); }, error => { if (this.#current(epoch)) this.#fail('LIVE_MODULE', 'module', error); return false; });
      context.onstatechange = () => { if (this.#current(epoch) && this.#prepared && context.state !== 'running') this.#fail('LIVE_INTERRUPTED', 'context'); };
      this.#timer = win.setInterval(() => this.#watch(), 200);
      const cancelled = new Promise(resolve => { this.#preparationCancel = () => resolve(false); });
      this.#emit();
      const preparation = Promise.all([resume, loaded]).then(() => {
        if (!this.#current(epoch)) return false;
        this.#revoke();
        if (this.#time() - this.#armedAt >= SETUP_MS) { this.#fail('LIVE_TIMEOUT', 'context'); return false; }
        if (context.state !== 'running') { this.#fail('LIVE_RESUME', 'resume'); return false; }
        this.#preparationCancel = null;
        this.#prepared = true; this.#state.status = 'armed'; this.#emit(); this.#reconcile(); return true;
      }).catch(() => { if (this.#current(epoch)) this.#fail('LIVE_CLOCK', 'context'); return false; });
      return Promise.race([preparation, cancelled]);
    } catch (error) {
      this.#fail(Object.hasOwn(ERROR_TEXT, error?.message) ? error.message : stage === 'module' ? 'LIVE_MODULE' : 'LIVE_CONTEXT', stage, error);
      return Promise.resolve(false);
    }
  }

  setRequest(requested, revision) {
    if (typeof requested !== 'boolean' || !this.#state.armed || this.#disposed) return false;
    const versioned = revision !== undefined;
    if (versioned && (!Number.isSafeInteger(revision) || revision < 0 ||
        (this.#requestRevision !== null && revision < this.#requestRevision))) return false;
    if (versioned) this.#requestRevision = revision;
    const changed = this.#appRequested !== requested; this.#appRequested = requested;
    // Audio replies and framebuffer replies can arrive in either order. A
    // snapshot at/before a withdrawal cannot undo it, but a later app request
    // can restart even when its intervening false frame was never displayed.
    if (versioned && this.#withdrawnRevision !== null && revision <= this.#withdrawnRevision) return true;
    const fresh = versioned && this.#withdrawnRevision !== null;
    if (fresh) this.#withdrawnRevision = null;
    // Older servers omit revision: conservatively require an observed edge.
    if (!changed && !fresh) return true;
    if (this.#state.requested === requested) return true;
    this.#state.requested = requested;
    if (!requested) { this.#endRun(); this.#state.status = this.#prepared ? 'armed' : 'preparing'; }
    this.#emit(); this.#reconcile(); return true;
  }
  #reconcile() {
    if (!this.#state.armed || !this.#state.requested || !this.#prepared || this.#run || this.#wire || this.#hidden()) return;
    let run;
    try {
      if (this.#time() - this.#armedAt >= MAX_MS) return this.#fail('LIVE_LIMIT', 'lifecycle');
      const entropy = new Uint32Array(4); this.#window.crypto.getRandomValues(entropy);
      const id = 'mic_' + Array.from(entropy, value => value.toString(16).padStart(8, '0')).join('');
      run = {id, sessionId: this.#sessionId, epoch: this.#epoch, ended: false, nativeMayExist: false, nativeStarted: false, stopSent: false,
        stream: null, node: null, source: null, listeners: [], queue: [], expectedSequence: 0, expectedFrame: 0,
        acceptedSequence: -1, acceptedFrame: 0, processorStarted: false, permissionPending: true, permissionAt: this.#time(), startedAt: null, lastSampleAt: null};
      this.#run = run; this.#state.status = 'starting'; this.#state.receivedFrames = 0; this.#emit();
      if (!this.#live(run)) return;
      this.#diagnose('microphone-access', 'pending');
      // No permission preflight: a host's query result is not an acquisition.
      const access = this.#window.navigator.mediaDevices.getUserMedia({audio: {channelCount: {ideal: 1}, sampleRate: {ideal: 16000},
        echoCancellation: false, noiseSuppression: false, autoGainControl: false}, video: false});
      Promise.resolve(access).then(stream => {
        run.permissionPending = false;
        if (!this.#live(run)) { stopStream(stream); this.#drive(run); return; }
        if (this.#time() - run.permissionAt >= PERMISSION_MS) { stopStream(stream); this.#fail('LIVE_TIMEOUT', 'microphone-access'); return; }
        run.stream = stream; this.#diagnose('microphone-access', 'resolved');
        const tracks = safely(() => stream.getAudioTracks());
        if (!Array.isArray(tracks) || tracks.length !== 1 || tracks[0].readyState !== 'live' || tracks[0].kind !== 'audio') return this.#fail('LIVE_STREAM', 'stream');
        const track = tracks[0], settings = safely(() => track.getSettings()) ?? {};
        this.#diagnose('stream', 'resolved', {channelCount: settings.channelCount, echoCancellation: settings.echoCancellation,
          noiseSuppression: settings.noiseSuppression, autoGainControl: settings.autoGainControl});
        const ended = () => { if (this.#live(run)) this.#fail('LIVE_INTERRUPTED', 'stream'); };
        track.addEventListener?.('ended', ended); run.listeners.push([track, ended]);
        if (!this.#live(run)) return;
        this.#diagnose('native-start', 'pending'); run.nativeMayExist = true;
        this.#dispatch(run, 'start', {source: 'browser'});
      }, error => {
        run.permissionPending = false;
        if (this.#live(run)) this.#fail(this.#permissionCode(error), 'microphone-access', error); else this.#drive(run);
      }).catch(() => { if (this.#live(run)) this.#fail('LIVE_STREAM', 'stream'); });
    } catch (error) { if (run) run.permissionPending = false; if (!run || this.#live(run)) this.#fail(this.#permissionCode(error), 'microphone-access', error); }
  }
  #permissionCode(error) {
    if (['NotAllowedError', 'SecurityError'].includes(error?.name)) return 'LIVE_PERMISSION';
    if (error?.name === 'NotFoundError') return 'LIVE_NO_DEVICE';
    if (error?.name === 'NotReadableError') return 'LIVE_DEVICE';
    if (error?.message === 'LIVE_CLOCK') return 'LIVE_CLOCK';
    return 'LIVE_STREAM';
  }
  #connect(run) {
    if (!this.#live(run)) return;
    let stage = 'worklet-node';
    try {
      if (this.#context?.state !== 'running') return this.#fail('LIVE_INTERRUPTED', 'context');
      this.#diagnose(stage, 'pending');
      run.node = new this.#window.AudioWorkletNode(this.#context, LIVE_MICROPHONE_PROCESSOR_NAME, {
        numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers',
      });
      run.node.port.onmessage = event => this.#message(run, event?.data);
      run.node.onprocessorerror = () => { if (this.#live(run)) this.#fail('LIVE_PROCESSOR', 'processor'); };
      this.#diagnose(stage, 'resolved');
      stage = 'media-source'; this.#diagnose(stage, 'pending');
      run.source = this.#context.createMediaStreamSource(run.stream); this.#diagnose(stage, 'resolved');
      stage = 'graph-connect'; this.#diagnose(stage, 'pending');
      run.source.connect(run.node); this.#diagnose(stage, 'resolved');
      run.startedAt = this.#time(); this.#diagnose('processor', 'pending');
      run.node.port.postMessage({type: 'begin'});
    } catch (error) { this.#fail({'worklet-node': 'LIVE_NODE', 'media-source': 'LIVE_SOURCE', 'graph-connect': 'LIVE_CONNECT'}[stage] ?? 'LIVE_PROCESSOR', stage, error); }
  }
  #message(run, data) {
    if (!this.#live(run)) { scrub(data?.samples); return; }
    let retained = false;
    try {
      const now = this.#time();
      if (now - this.#armedAt >= MAX_MS) return this.#fail('LIVE_LIMIT', 'lifecycle');
      if (data?.type === 'error') { this.#diagnose('processor', 'failed', {processorReason: data.code}); return this.#fail(data.code === 'OVERRUN' ? 'LIVE_OVERRUN' : 'LIVE_PROCESSOR', 'processor', null, data.code); }
      if (data?.type === 'limit') return this.#fail('LIVE_LIMIT', 'lifecycle');
      if (!run.processorStarted && now - run.startedAt >= RESPONSE_MS) return this.#fail('LIVE_TIMEOUT', 'processor');
      if (run.processorStarted && now - run.lastSampleAt >= RESPONSE_MS) return this.#fail('LIVE_TIMEOUT', 'processor');
      if (data?.type === 'started') {
        if (run.processorStarted || data.sampleRate !== 16000) return this.#fail('LIVE_DATA', 'processor');
        run.processorStarted = true; run.lastSampleAt = now;
        this.#diagnose('processor', 'resolved'); this.#state.status = 'active'; this.#emit(); return;
      }
      if (data?.type !== 'chunk' || !run.processorStarted || data.sampleRate !== 16000 || data.frames !== 1600 ||
          data.sequence !== run.expectedSequence || data.firstFrame !== run.expectedFrame || !(data.samples instanceof ArrayBuffer) ||
          data.samples.byteLength !== data.frames * 2 || !Number.isFinite(data.level) || data.level < 0 || data.level > 1 ||
          data.firstFrame + data.frames > 4800000) return this.#fail('LIVE_DATA', 'processor');
      // Nine waiting chunks plus one in flight tolerate up to one second of
      // browser/transport jitter; they are sent immediately, never padded.
      if (run.queue.length >= 9) return this.#fail('LIVE_OVERRUN', 'transport');
      run.expectedSequence++; run.expectedFrame += data.frames; run.lastSampleAt = now;
      run.queue.push({samples: data.samples, sequence: data.sequence, firstFrame: data.firstFrame, frames: data.frames}); retained = true;
      this.#level(data.level); this.#drive(run);
    } catch { this.#fail('LIVE_DATA', 'processor'); }
    finally { if (!retained) scrub(data?.samples); }
  }
  #drive(run) {
    if (this.#wire || this.#run !== run) return;
    if (run.ended) {
      // A permission prompt cannot be cancelled programmatically. Keep this
      // single pending acquisition as a fence until its eventual grant/denial.
      if (run.permissionPending) return;
      if (run.nativeMayExist && !run.stopSent) { run.stopSent = true; this.#dispatch(run, 'stop'); }
      else this.#finishRun(run);
      return;
    }
    if (!this.#live(run) || !run.nativeStarted || !run.queue.length) return;
    const chunk = run.queue.shift();
    try {
      let binary = ''; for (const byte of new Uint8Array(chunk.samples)) binary += String.fromCharCode(byte);
      const pcmBase64 = this.#window.btoa(binary); binary = '';
      this.#dispatch(run, 'chunk', {sequence: chunk.sequence, firstFrame: chunk.firstFrame, pcmBase64}, chunk.frames);
    } catch (error) { this.#fail('LIVE_TRANSPORT', 'transport', error); }
    finally { scrub(chunk.samples); }
  }
  #dispatch(run, action, fields = {}, frames = 0) {
    if (this.#wire) return this.#fail('LIVE_DATA', 'transport');
    let startedAt;
    try { startedAt = this.#time(); } catch { return this.#fail('LIVE_CLOCK', 'transport'); }
    const wire = {run, action, startedAt}; this.#wire = wire;
    const expectedSequence = action === 'start' ? -1 : action === 'chunk' ? fields.sequence : run.acceptedSequence;
    const expectedFrame = action === 'start' ? 0 : action === 'chunk' ? fields.firstFrame + frames : run.acceptedFrame;
    let response;
    try { response = this.#call('m5stack_audio', {sessionId: run.sessionId, streamId: run.id, action, ...fields}); }
    catch (error) { response = Promise.reject(error); }
    Promise.resolve(response).then(result => {
      if (this.#wire !== wire) return;
      // Validate deadlines at settlement as well as on interval ticks: hidden
      // or blocked UI threads can delay timers behind a transport response.
      if (this.#state.armed) {
        const now = this.#time();
        if (now - this.#armedAt >= MAX_MS) this.#fail('LIVE_LIMIT', 'lifecycle');
        else if (now - wire.startedAt >= RESPONSE_MS) this.#fail('LIVE_TIMEOUT', 'transport');
      }
      const ack = result?.structuredContent;
      if (result?.isError || !ack || ack.sessionId !== run.sessionId || ack.streamId !== run.id || ack.action !== action ||
          typeof ack.accepted !== 'boolean' || typeof ack.requested !== 'boolean' || typeof ack.active !== 'boolean' ||
          (ack.revision !== undefined && (!Number.isSafeInteger(ack.revision) || ack.revision < 0))) throw new Error('invalid acknowledgment');
      const declined = ack.accepted === false && ack.requested === false && ack.active === false;
      if (declined) {
        if (ack.sequence !== run.acceptedSequence || ack.nextFrame !== run.acceptedFrame) throw new Error('invalid declined acknowledgment');
      } else {
        if (!ack.accepted || ack.sequence !== expectedSequence || ack.nextFrame !== expectedFrame || (action === 'stop' && ack.active)) throw new Error('invalid acknowledgment counters');
        run.acceptedSequence = ack.sequence; run.acceptedFrame = ack.nextFrame;
        if (this.#live(run)) { this.#state.receivedFrames = ack.nextFrame; this.#emit(); }
      }
      if (action === 'stop') run.nativeMayExist = false;
      if ((!ack.requested || (!ack.active && action !== 'stop')) && this.#run === run && this.#current(run.epoch)) {
        const newerRequest = ack.revision !== undefined && this.#requestRevision !== null && this.#requestRevision > ack.revision;
        this.#withdrawnRevision = newerRequest ? null : ack.revision ?? null;
        this.#state.requested = newerRequest && this.#appRequested;
        this.#endRun(); this.#state.status = 'armed'; this.#emit(); return;
      }
      if (action === 'stop' || !this.#live(run)) return;
      if (action === 'start') { run.nativeStarted = true; this.#diagnose('native-start', 'resolved'); this.#connect(run); }
      else { run.node?.port.postMessage({type: 'ack', sequence: ack.sequence}); this.#diagnose('transport', 'resolved'); }
    }, error => { throw error; }).catch(error => {
      if (this.#run === run && this.#current(run.epoch)) this.#fail(error?.message === 'LIVE_CLOCK' ? 'LIVE_CLOCK' : 'LIVE_TRANSPORT', 'transport', error);
      if (action === 'stop') run.nativeMayExist = false;
    }).finally(() => {
      if (this.#wire !== wire) return;
      this.#wire = null; this.#drive(run);
    });
  }
  #endRun() {
    const run = this.#run;
    if (!run || run.ended) return;
    run.ended = true;
    for (const chunk of run.queue) scrub(chunk.samples); run.queue = [];
    for (const [track, handler] of run.listeners) safely(() => track.removeEventListener?.('ended', handler)); run.listeners = [];
    stopStream(run.stream); run.stream = null;
    const node = run.node; run.node = null;
    if (node) {
      node.onprocessorerror = null; node.port.onmessage = event => scrub(event?.data?.samples);
      safely(() => node.port.postMessage({type: 'cancel'})); safely(() => node.disconnect()); safely(() => node.port.close());
    }
    safely(() => run.source?.disconnect()); run.source = null; this.#level(0);
    this.#drive(run);
  }
  #finishRun(run) { if (this.#run === run) { this.#run = null; this.#reconcile(); } }
  #watch() {
    if (!this.#state.armed) return;
    try {
      const now = this.#time(), run = this.#run;
      if (this.#hidden()) return this.disable('hidden');
      if (now - this.#armedAt >= MAX_MS) return this.#fail('LIVE_LIMIT', 'lifecycle');
      if (!this.#prepared && now - this.#armedAt >= SETUP_MS) return this.#fail('LIVE_TIMEOUT', 'context');
      if (this.#wire && now - this.#wire.startedAt >= RESPONSE_MS) return this.#fail('LIVE_TIMEOUT', 'transport');
      if (run && !run.ended) {
        if (!run.stream && now - run.permissionAt >= PERMISSION_MS) return this.#fail('LIVE_TIMEOUT', 'microphone-access');
        if (run.startedAt !== null && now - (run.lastSampleAt ?? run.startedAt) >= RESPONSE_MS) return this.#fail('LIVE_TIMEOUT', 'processor');
      }
    } catch { this.#fail('LIVE_CLOCK', 'lifecycle'); }
  }
  #revoke() { if (this.#moduleUrl !== null) safely(() => this.#window.URL.revokeObjectURL(this.#moduleUrl)); this.#moduleUrl = null; }
  #releaseContext() {
    this.#prepared = false;
    this.#preparationCancel?.(); this.#preparationCancel = null;
    if (this.#timer !== null) safely(() => this.#window.clearInterval(this.#timer)); this.#timer = null;
    this.#revoke();
    const context = this.#context; this.#context = null;
    if (context) { context.onstatechange = null; safely(() => Promise.resolve(context.close()).catch(noop)); }
  }
  #fail(code, stage, error, processorReason) {
    if (!Object.hasOwn(ERROR_TEXT, code)) code = 'LIVE_DATA';
    this.#diagnose(stage, 'failed', {errorCode: code, error, processorReason});
    this.#state.armed = false; this.#state.status = 'error'; this.#state.errorCode = code; this.#state.error = ERROR_TEXT[code];
    if(code==='LIVE_TIMEOUT' && stage==='microphone-access')this.#state.error='Microphone permission did not finish. Keep this tab active, respond to the browser permission prompt, then tap the device or press its button to retry.';
    ++this.#epoch; this.#endRun(); this.#releaseContext(); this.#level(0); this.#emit();
  }
  disable(reason = 'disabled') {
    if (reason === 'session-change') { this.#state.receivedFrames = 0; this.#diagnostics = []; }
    ++this.#epoch; this.#state.armed = false; this.#state.requested = false; this.#state.status = 'off'; this.#state.error = null; this.#state.errorCode = null;
    this.#endRun(); this.#releaseContext(); this.#level(0); this.#emit();
  }
  dispose() {
    if (this.#disposed) return;
    this.disable('dispose'); this.#disposed = true;
    this.#document?.removeEventListener?.('visibilitychange', this.#visibility);
    this.#window.removeEventListener?.('pagehide', this.#pagehide);
  }
}
