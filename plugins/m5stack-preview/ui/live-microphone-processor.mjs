// A self-contained bundled AudioWorklet module. No imports, network, storage,
// or speaker output. Credits bound transferred chunks even if the UI stalls.
export function installLiveMicrophoneProcessor(scope) {
  const NAME = 'm5stack-live-pcm16-v1', RATE = 16000, CHUNK = 1600, MAX = RATE * 300, CREDITS = 10;
  class LiveMicrophoneProcessor extends scope.AudioWorkletProcessor {
    constructor() {
      super();
      this.phase = 'idle'; this.buffer = null; this.view = null; this.used = 0; this.frames = 0;
      this.sequence = 0; this.nextAck = 0; this.credits = CREDITS; this.squares = 0; this.started = false;
      this.port.onmessage = event => this.command(event.data);
    }
    scrub() { if (this.buffer) new Uint8Array(this.buffer).fill(0); this.buffer = null; this.view = null; this.used = 0; this.squares = 0; }
    fail(code) {
      if (['error', 'cancelled', 'complete'].includes(this.phase)) return;
      this.phase = 'error'; this.scrub();
      try { this.port.postMessage({type: 'error', code}); } catch {}
    }
    command(message) {
      if (['error', 'cancelled', 'complete'].includes(this.phase)) return;
      if (!message || typeof message !== 'object' || Array.isArray(message)) return this.fail('INVALID_COMMAND');
      if (message.type === 'ack' && Object.keys(message).length === 2) {
        if (this.phase !== 'active' || message.sequence !== this.nextAck || this.nextAck >= this.sequence || this.credits >= CREDITS) return this.fail('INVALID_COMMAND');
        this.nextAck++; this.credits++; return;
      }
      if (Object.keys(message).length !== 1 || !['begin', 'cancel'].includes(message.type)) return this.fail('INVALID_COMMAND');
      if (message.type === 'cancel') { this.phase = 'cancelled'; this.scrub(); return; }
      if (this.phase !== 'idle') return this.fail('INVALID_COMMAND');
      if (scope.sampleRate !== RATE) return this.fail('UNSUPPORTED_SAMPLE_RATE');
      this.phase = 'active';
    }
    emitChunk() {
      if (!this.credits) { this.fail('OVERRUN'); return false; }
      const samples = this.buffer, count = this.used, firstFrame = this.frames - count;
      this.buffer = null; this.view = null; this.used = 0; this.credits--;
      const level = Math.min(1, Math.sqrt(this.squares / count)); this.squares = 0;
      try {
        this.port.postMessage({type: 'chunk', samples, frames: count, firstFrame, sequence: this.sequence++, sampleRate: RATE, level}, [samples]);
      } catch {
        if (samples.byteLength) new Uint8Array(samples).fill(0);
        this.fail('TRANSFER_FAILED'); return false;
      }
      return true;
    }
    process(inputs, outputs) {
      for (const bus of outputs ?? []) for (const channel of bus ?? []) channel.fill(0);
      if (this.phase !== 'active') return this.phase === 'idle';
      if (scope.sampleRate !== RATE) { this.fail('UNSUPPORTED_SAMPLE_RATE'); return false; }
      if (!Array.isArray(inputs) || inputs.length > 1 || !Array.isArray(inputs[0] ?? [])) { this.fail('INVALID_CHANNELS'); return false; }
      const channels = inputs[0] ?? [];
      if (!channels.length) return true;
      if (channels.length !== 1) { this.fail('INVALID_CHANNELS'); return false; }
      const block = channels[0];
      if (!(block instanceof Float32Array) || block.length > 8192) { this.fail('INVALID_BLOCK'); return false; }
      for (const sample of block) if (!Number.isFinite(sample)) { this.fail('NONFINITE_SAMPLE'); return false; }
      if (!block.length) return true;
      if (!this.started) { this.started = true; this.port.postMessage({type: 'started', sampleRate: RATE}); }
      for (const sample of block) {
        if (!this.buffer) { this.buffer = new ArrayBuffer(CHUNK * 2); this.view = new DataView(this.buffer); }
        const value = Math.max(-1, Math.min(1, sample));
        this.view.setInt16(this.used * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
        this.used++; this.frames++; this.squares += value * value;
        if (this.used === CHUNK && !this.emitChunk()) return false;
        if (this.frames === MAX) {
          this.phase = 'complete'; this.scrub(); this.port.postMessage({type: 'limit'}); return false;
        }
      }
      return true;
    }
  }
  scope.registerProcessor(NAME, LiveMicrophoneProcessor);
}

export const LIVE_MICROPHONE_PROCESSOR_NAME = 'm5stack-live-pcm16-v1';
export const LIVE_MICROPHONE_WORKLET_SOURCE = '(' + installLiveMicrophoneProcessor.toString() + ')(globalThis);';
