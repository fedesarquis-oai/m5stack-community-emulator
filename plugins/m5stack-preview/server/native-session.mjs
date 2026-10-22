/** Native framebuffer supervisor with optional bounded workspace network adapter. */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import {HostNetwork,validNetworkState} from './network-adapter.mjs';
import {speakerFrames} from '../ui/speaker-pcm.mjs';

const MAX_HEADER = 8192;
const MAX_METADATA = 16384;
const MAX_QUEUE = 8;
const MAX_DEDUPE = 64;
const MAX_AUDIO_FRAMES = 1600;
const MAX_AUDIO_TOTAL_FRAMES = 16000 * 300;
const MAX_AUDIO_LIFETIME_MS = 300000;
const MAX_BINARY = 64 * 1024 * 1024;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_SOURCE_FILES = 4096;
const APPS = new Set(['custom', 'counter']);
import {DEVICE_PROFILE_BY_ID as PROFILES} from '../ui/device-profiles.mjs';
const digest = data => createHash('sha256').update(data).digest('hex');
const hex64 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const within = (root, file) => file !== root && !path.relative(root, file).startsWith('..' + path.sep) && path.relative(root, file) !== '..' && !path.isAbsolute(path.relative(root, file));

export class NativeSessionError extends Error {
  constructor(code, message) { super(message); this.name = 'NativeSessionError'; this.code = code; }
}
const fail = (code, message) => new NativeSessionError(code, message);
function exactKeys(value, required, optional = []) {
  return value && typeof value === 'object' && !Array.isArray(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}

// Only a worker with this explicit contract can advertise native media. Older
// prepared workers remain usable with media disabled until rebuilt from source.
function mediaCapabilities(state, profile, appId) {
  const supported = state?.media_adapter === 1;
  const microphone = supported && profile.microphone;
  const audioOutput = supported && ['custom', 'counter'].includes(appId) ? profile.audioOutput : 'none';
  return { mediaAdapter: supported ? 1 : 0, microphone,
    microphoneMode: microphone ? 'level' : 'none',
    microphoneMapping: microphone ? 'user-app' : 'none',
    audioOutput, speakerPcm: audioOutput==='speaker' && state?.speaker_output_adapter===1,
    audioMode: audioOutput === 'none' ? 'none' : audioOutput==='speaker' && state?.speaker_output_adapter===1 ? 'pcm' : 'tone' };
}

function appCapabilities(state,profile,appId) {
  const supported=state?.app_adapter===1 && ['counter','custom'].includes(appId);
  const captureAdapter=supported&&state?.capture_adapter===1;
  const touchStrip=supported&&state?.touch_strip_adapter===1&&profile.id==='cores3se'&&state?.profile===profile.id&&state?.app===appId;
  return {appAdapter:supported?1:0,secondaryButton:supported&&profile.secondaryButton===true&&state?.secondary_button_adapter===1&&state?.profile===profile.id&&state?.app===appId,spatialTouch:supported&&profile.primaryInput==='touch',
    touchStrip,touchWidth:profile.width,touchHeight:touchStrip?280:profile.height,
    powerButton:supported&&state?.power_button_adapter===1&&['cores3','cores3se'].includes(profile.id)&&state?.profile===profile.id,
    recordingInput:supported&&profile.microphone,imageInput:supported,textInput:supported,
    captureAdapter:captureAdapter?1:0,captureHandshake:captureAdapter&&profile.microphone};
}
const assetId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(value);
const audioMimes=Object.freeze({'audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'mp4','audio/wav':'wav'});
function validRecording(value) {
  return exactKeys(value,['id','mime_type','duration_ms','bytes','sha256','source'])&&assetId(value.id)&&
    Object.hasOwn(audioMimes,value.mime_type)&&Number.isInteger(value.duration_ms)&&value.duration_ms>=1&&value.duration_ms<=30000&&
    Number.isInteger(value.bytes)&&value.bytes>=1&&value.bytes<=2097152&&hex64(value.sha256)&&['browser','fixture'].includes(value.source);
}
function validResultContext(value){return exactKeys(value,['draftId','requestId','revision'])&&assetId(value.draftId)&&assetId(value.requestId)&&Number.isSafeInteger(value.revision)&&value.revision>=1;}
function nativeResult(value){return value?{draftId:value.draft_id,requestId:value.request_id,revision:value.revision}:null;}
function validateAppState(header,profile,appId) {
  if(Object.hasOwn(header,'app_input_accepted')&&header.app_input_accepted!==null&&typeof header.app_input_accepted!=='boolean')
    throw fail('INVALID_ASSET','Native input acknowledgment must be boolean or null.');
  const cap=appCapabilities(header,profile,appId);
  if(!cap.appAdapter)return {...header,recording:null,recording_capture:null,capture_intent:null,image:null,expected_result:null};
  if(header.recording!==null&&(!cap.recordingInput||!validRecording(header.recording)))throw fail('INVALID_ASSET','Native recording metadata violates the app contract.');
  const capture=header.recording_capture;
  if(capture!==null&&(!cap.recordingInput||!exactKeys(capture,cap.captureAdapter?['id','source','stopped']:['id','source'])||!assetId(capture.id)||!['browser','fixture'].includes(capture.source)||
    (cap.captureAdapter&&typeof capture.stopped!=='boolean')))throw fail('INVALID_ASSET','Native capture acknowledgment is invalid.');
  if(cap.captureAdapter){
    const intent=header.capture_intent;
    if(intent!==null&&(!cap.captureHandshake||!exactKeys(intent,['id','source','action','sequence'])||!assetId(intent.id)||!['browser','fixture'].includes(intent.source)||
      !['start','stop','cancel'].includes(intent.action)||!Number.isSafeInteger(intent.sequence)||intent.sequence<1))throw fail('INVALID_ASSET','Native capture intent is invalid.');
    if(capture&&header.recording)throw fail('INVALID_ASSET','Native capture and completed recording overlap.');
    if(intent&&((intent.action==='stop'&&(!capture||capture.id!==intent.id||capture.source!==intent.source||capture.stopped))||
      (['start','cancel'].includes(intent.action)&&(capture||header.recording))))throw fail('INVALID_ASSET','Native capture intent conflicts with its lifecycle state.');
  }
  const img=header.image;
  if(img!==null&&(!exactKeys(img,['id','width','height'])||!assetId(img.id)||!Number.isInteger(img.width)||!Number.isInteger(img.height)||img.width<1||img.height<1||img.width>profile.width||img.height>profile.height))throw fail('INVALID_ASSET','Native image metadata violates the app contract.');
  const expected=header.expected_result;
  if(expected!==null&&(!exactKeys(expected,['draft_id','request_id','revision'])||!validResultContext(nativeResult(expected))))throw fail('INVALID_ASSET','Native result expectation is invalid.');
  return cap.captureAdapter?header:{...header,capture_intent:null};
}

function audioCapabilities(state, profile) {
  const supported = profile.microphone && state?.audio_input_adapter === 1;
  return {audioInputAdapter:supported?1:0,microphonePcm:supported};
}
function validAudioPosition(sequence,nextFrame) {
  return Number.isSafeInteger(sequence)&&sequence>=-1&&sequence<MAX_AUDIO_TOTAL_FRAMES&&
    Number.isSafeInteger(nextFrame)&&nextFrame>=0&&nextFrame<=MAX_AUDIO_TOTAL_FRAMES&&
    ((sequence===-1&&nextFrame===0)||(sequence>=0&&nextFrame>=sequence+1&&nextFrame<=(sequence+1)*MAX_AUDIO_FRAMES));
}
function validateAudioState(header, profile) {
  if(!audioCapabilities(header,profile).microphonePcm)return {...header,audio_input:null};
  const a=header.audio_input;
  if(!exactKeys(a,['requested','active','stream_id','source','sequence','next_frame','received_frames','level'])||
    typeof a.requested!=='boolean'||typeof a.active!=='boolean'||!validAudioPosition(a.sequence,a.next_frame)||
    (a.received_frames!==null&&(!Number.isSafeInteger(a.received_frames)||a.received_frames<0||a.received_frames>MAX_AUDIO_TOTAL_FRAMES))||
    (a.level!==null&&(typeof a.level!=='number'||!Number.isFinite(a.level)||a.level<0||a.level>1))||
    (a.stream_id===null ? (a.source!==null||a.active||a.sequence!==-1||a.next_frame!==0) : (!assetId(a.stream_id)||!['browser','fixture'].includes(a.source)))||
    (a.active&&!a.requested))throw fail('INVALID_AUDIO_STATE','Native microphone state violates the bounded audio contract.');
  return header;
}

function validateMediaState(header, profile, appId) {
  const media = mediaCapabilities(header, profile, appId);
  if (!media.mediaAdapter) return { ...header, app_sound: null, output_tone: null };
  if (typeof header.mic_level !== 'number' || !Number.isFinite(header.mic_level) ||
      header.mic_level < 0 || header.mic_level > 100 ||
      !['fixture', 'browser'].includes(header.mic_source) ||
      (!profile.microphone && header.mic_level !== 0))
    throw fail('INVALID_MEDIA', 'Native microphone level does not match the media contract.');
  const sound = header.app_sound;
  if (sound !== null && sound !== undefined && (
      !['tone','pcm'].includes(media.audioMode) ||
      !exactKeys(sound, ['id', 'origin', 'cue', 'frequency_hz', 'duration_ms', 'kind']) ||
      !Number.isSafeInteger(sound.id) || sound.id < 1 || sound.origin !== 'app' ||
      typeof sound.cue !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(sound.cue) ||
      !Number.isInteger(sound.frequency_hz) || sound.frequency_hz < 40 || sound.frequency_hz > 4000 ||
      !Number.isInteger(sound.duration_ms) || sound.duration_ms < 1 || sound.duration_ms > 1000 ||
      sound.kind !== media.audioOutput))
    throw fail('INVALID_MEDIA', 'Native authored sound is outside the bounded tone contract.');
  // Diagnostic audio has no native input route in this adapter. Never forward
  // old worker diagnostics as if they were a validated app-authored tone.
  const speaker=header.speaker_output ?? null;
  if(media.speakerPcm && (!speaker || speakerFrames(speaker)<0))throw fail('INVALID_SPEAKER_PCM','Native speaker output violates the bounded PCM contract.');
  return { ...header, app_sound: sound ?? null, output_tone: null, speaker_output:media.speakerPcm?speaker:null };
}

/** Byte-for-byte v6 source_digest algorithm, implemented independently in Node. */
export async function sourceDigest(workspaceRoot, profileId) {
  if (!Object.hasOwn(PROFILES, profileId)) throw fail('UNSUPPORTED_PROFILE', 'Unsupported source digest profile.');
  let root;
  try { root = await fs.realpath(workspaceRoot); }
  catch { throw fail('INVALID_WORKSPACE', 'The authorized source workspace is unavailable.'); }
  const names = new Set(['dependencies.lock.json', 'scripts/virtual_device.py', 'vendor/M5GFX/src/lgfx/Fonts/glcdfont.h']);
  async function contained(name, directory = false) {
    try {
      const target = await fs.realpath(path.join(root, name));
      if (!within(root, target)) throw fail('INVALID_SOURCE', 'A source resource escapes the authorized workspace.');
      const stat = await fs.stat(target);
      if (directory ? !stat.isDirectory() : !stat.isFile()) throw fail('INVALID_SOURCE', 'An expected source resource has the wrong type.');
      return { target, stat };
    } catch (error) { if (error instanceof NativeSessionError) throw error; throw fail('INVALID_SOURCE', 'Required source resources are unavailable.'); }
  }
  for (const name of ['scripts/eightball_shared.py','scripts/wav_fixture.py']) {
    try { await fs.lstat(path.join(root,name)); await contained(name); names.add(name); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const src = await contained('src', true);
  for (const entry of await fs.readdir(src.target, { withFileTypes: true })) {
    if (['.h', '.hpp', '.cpp'].includes(path.extname(entry.name))) {
      const name = `src/${entry.name}`; await contained(name); names.add(name);
      if (names.size > MAX_SOURCE_FILES) throw fail('INVALID_SOURCE', 'Source file inventory exceeds the supported bound.');
    }
  }
  // pathlib.rglob does not follow symlinked directories. Regular data resources
  // and file symlinks are accepted only after their canonical path is contained.
  await contained('data', true);
  let directories = 1;
  async function dataFiles(relative) {
    for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (++directories > MAX_SOURCE_FILES) throw fail('INVALID_SOURCE', 'Source directory inventory exceeds the supported bound.');
        await contained(name, true); await dataFiles(name);
      }
      else if (['.json', '.wav', '.pem'].includes(path.extname(entry.name))) { await contained(name); names.add(name); }
      if (names.size > MAX_SOURCE_FILES) throw fail('INVALID_SOURCE', 'Source file inventory exceeds the supported bound.');
    }
  }
  await dataFiles('data');
  try { await fs.lstat(path.join(root, 'scripts/generate_content.py')); await contained('scripts/generate_content.py'); names.add('scripts/generate_content.py'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const hasher = createHash('sha256').update(profileId + '\0'); let total = 0;
  // UTF-8 lexical ordering matches Python's Unicode-codepoint order, including
  // filenames outside the BMP (JavaScript's default sort compares UTF-16).
  for (const name of [...names].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
    const { target, stat } = await contained(name);
    total += stat.size;
    if (total > MAX_SOURCE_BYTES) throw fail('INVALID_SOURCE', 'Source resources exceed the supported total size.');
    const bytes = await fs.readFile(target);
    if (bytes.length !== stat.size) throw fail('SOURCE_CHANGED', 'Source changed during validation; prepare a fresh build.');
    hasher.update(name + '\0').update(bytes);
  }
  return hasher.digest('hex');
}

// PNG encoding changes only the container; RGB bytes are the native framebuffer.
const CRC_TABLE = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let bit = 0; bit < 8; bit++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
  return c >>> 0;
});
function chunk(type, body) {
  const label = Buffer.from(type), out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length); label.copy(out, 4); body.copy(out, 8);
  let crc = 0xffffffff;
  for (const value of Buffer.concat([label, body])) crc = CRC_TABLE[(crc ^ value) & 255] ^ (crc >>> 8);
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, body.length + 8);
  return out;
}
export function encodeNativePng(rgb, width, height) {
  if (!Buffer.isBuffer(rgb) || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 320 || height > 320 || rgb.length !== width * height * 3) throw fail('INVALID_FRAME', 'Native RGB geometry is invalid.');
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) rgb.copy(rows, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

async function preparedBuild(workspaceRoot, profileId, appId) {
  if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot)) throw fail('INVALID_WORKSPACE', 'An authorized absolute workspace root is required.');
  if (!Object.hasOwn(PROFILES, profileId)) throw fail('UNSUPPORTED_PROFILE', 'This device profile is not supported by the native adapter.');
  if (!APPS.has(appId)) throw fail('UNSUPPORTED_APP', 'This app requires a separate supported adapter.');
  let root, buildRoot, metadataPath;
  try {
    root = await fs.realpath(workspaceRoot);
    buildRoot = await fs.realpath(path.join(root, '.build', 'virtual-device'));
    if (!within(root, buildRoot)) throw fail('INVALID_BUILD', 'Build directory escapes the authorized workspace.');
    metadataPath = await fs.realpath(path.join(buildRoot, profileId === 'stickcplus2' ? 'build.json' : `build-${profileId}.json`));
    if (!within(buildRoot, metadataPath)) throw fail('INVALID_BUILD', 'Build metadata escapes the approved build directory.');
  } catch (error) { if (error instanceof NativeSessionError) throw error; throw fail('BUILD_REQUIRED', 'A prepared native build is required for this profile.'); }
  let meta;
  try {
    const stat = await fs.stat(metadataPath);
    if (!stat.isFile() || stat.size > MAX_METADATA) throw fail('INVALID_BUILD', 'Build metadata exceeds the supported size.');
    meta = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  } catch (error) { if (error instanceof NativeSessionError) throw error; throw fail('INVALID_BUILD', 'Build metadata could not be read.'); }
  const profile = PROFILES[profileId];
  if (!meta || typeof meta !== 'object' || Array.isArray(meta) || meta.profile !== profileId || meta.width !== profile.width || meta.height !== profile.height || typeof meta.build_id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(meta.build_id) || !hex64(meta.source_sha256) || !hex64(meta.binary_sha256) || typeof meta.binary !== 'string' || !/^worker-[a-zA-Z0-9_.-]+$/.test(meta.binary)) throw fail('INVALID_BUILD', 'Build metadata does not match the selected native profile.');
  if (meta.apps !== undefined && (!Array.isArray(meta.apps) || !meta.apps.includes(appId))) throw fail('UNSUPPORTED_APP', 'The prepared worker does not include this app.');
  if (await sourceDigest(root, profileId) !== meta.source_sha256) throw fail('STALE_BUILD', 'Source changed since this native build. Prepare a new build before previewing.');
  const selected = path.join(buildRoot, meta.binary);
  let binary;
  try {
    binary = await fs.realpath(selected);
    if (!within(buildRoot, binary)) throw fail('INVALID_BUILD', 'Worker executable escapes the approved build directory.');
    const stat = await fs.stat(binary);
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_BINARY) throw fail('INVALID_BUILD', 'Worker executable is not a bounded regular file.');
    if (digest(await fs.readFile(binary)) !== meta.binary_sha256) throw fail('BUILD_CHANGED', 'The native executable changed; prepare a new build before previewing.');
  } catch (error) { if (error instanceof NativeSessionError) throw error; throw fail('BUILD_REQUIRED', 'The prepared native executable is unavailable.'); }
  return { root, binary, meta, profile };
}

/** Caller must authorize workspaceRoot. This class is not an OS application sandbox. */
export class NativeSession {
  static async open({ workspaceRoot, profileId, appId = 'custom', ioTimeoutMs = 5000, closeTimeoutMs = 2000 }) {
    if (!Number.isInteger(ioTimeoutMs) || ioTimeoutMs < 10 || ioTimeoutMs > 10000 || !Number.isInteger(closeTimeoutMs) || closeTimeoutMs < 50 || closeTimeoutMs > 2000) throw fail('INVALID_LIMIT', 'Native timeouts are outside supported bounds.');
    const prepared = await preparedBuild(workspaceRoot, profileId, appId);
    const session = new NativeSession(prepared, { profileId, appId, ioTimeoutMs, closeTimeoutMs });
    try { await session._launch(); return session; }
    catch (error) { await session.close(); throw error; }
  }
  constructor(prepared, options) {
    this._prepared = prepared; Object.assign(this, options);
    this.sessionId = randomBytes(24).toString('base64url'); this.buildId = prepared.meta.build_id;
    this._status = 'starting'; this._exitCode = null; this._error = null;
    this._frame = null; this._state = null; this._revision = 0;
    this._pending = null; this._buffer = Buffer.alloc(0); this._header = null;
    this._tail = Promise.resolve(); this._queued = 0; this._dedupe = new Map();
    this._network=new HostNetwork(prepared.root);this._networkActive=null;
    this._audioBusy=false; this._audioStream=null; this._audioIds=new Set();
    this._captureIds = new Set(); // Never evict capture identities during a session.
    this._child = null; this._closePromise = null; this._stderrTail = Buffer.alloc(0);
  }
  async _launch() {
    const initial = this._expectFrame();
    // stdout is exclusively native binary protocol; MCP stdout belongs to the parent server.
    const child = this._child = spawn(this._prepared.binary, [this.profileId, this.appId], { cwd: this._prepared.root, shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.on('data', data => this._read(data));
    child.stderr.on('data', data => { this._stderrTail = Buffer.concat([this._stderrTail, data]).subarray(-8192); });
    child.stdin.on('error', () => this._markFailed(fail('NATIVE_WRITE_FAILED', 'Native input pipe closed. Reload to recover.')));
    child.on('error', () => this._markFailed(fail('NATIVE_START_FAILED', 'The native worker could not start.')));
    child.on('exit', (code, signal) => {
      this._exitCode = code ?? signal ?? null;
      if (this._status !== 'stopped') this._markFailed(fail('NATIVE_EXITED', 'Native renderer exited. The last frame is preserved; reload to recover.'), 'exited');
    });
    await initial;
  }
  _expectFrame(audioRequest=null) {
    if (this._pending) throw fail('NATIVE_BUSY', 'A native command is already in flight.');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this._markFailed(fail('NATIVE_TIMEOUT', 'Native renderer did not complete within its deadline. Reload to recover.')), this.ioTimeoutMs);
      this._pending = { resolve, reject, timer, audioRequest };
    });
  }
  _markFailed(error, status = 'unavailable') {
    this._networkActive?.controller.abort();this._networkActive=null;
    clearTimeout(this._audioTimer);this._audioTimer=null;
    if (this._status !== 'stopped') { this._status = status; this._error = error; }
    if (this._pending) { const pending = this._pending; this._pending = null; clearTimeout(pending.timer); pending.reject(error); }
    this._buffer = Buffer.alloc(0); this._header = null;
  }
  _read(data) {
    if (this._status === 'stopped') return;
    if (!this._pending) { this._markFailed(fail('UNSOLICITED_FRAME', 'Unexpected native output invalidated the session. Reload to recover.')); return; }
    const { width, height } = this._prepared.profile, pixels = width * height * 3;
    const headerLimit=this._prepared.profile.audioOutput==='speaker'&&!this._pending.audioRequest?40960:MAX_HEADER;
    if (this._buffer.length + data.length > headerLimit + 1 + (this._pending.audioRequest?0:pixels)) { this._markFailed(fail('INVALID_FRAME', 'Native frame exceeds its bounded protocol size.')); return; }
    this._buffer = Buffer.concat([this._buffer, data]);
    try {
      if (!this._header) {
        const newline = this._buffer.indexOf(10);
        if (newline < 0) { if (this._buffer.length > headerLimit) throw fail('INVALID_HEADER', 'Native header exceeds its size limit.'); return; }
        if (newline > headerLimit) throw fail('INVALID_HEADER', 'Native header exceeds its size limit.');
        let header;
        try { header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(this._buffer.subarray(0, newline))); }
        catch { throw fail('INVALID_HEADER', 'Native header is not valid bounded JSON.'); }
        if(this._pending.audioRequest){
          if(this._buffer.length!==newline+1)throw fail('INVALID_AUDIO_ACK','Unexpected bytes followed the native audio acknowledgment.');
          const ack=this._acceptAudioAck(header,this._pending.audioRequest);
          const pending=this._pending;this._pending=null;clearTimeout(pending.timer);this._buffer=Buffer.alloc(0);
          pending.resolve(ack);return;
        }
        if (!header || typeof header !== 'object' || Array.isArray(header) || header.width !== width || header.height !== height || header.profile !== this.profileId || header.app !== this.appId) throw fail('INVALID_GEOMETRY', 'Native frame identity or geometry does not match the selected app/device.');
        if(header.network_adapter===1 && (PROFILES[this.profileId]?.network?.adapter!==1||!validNetworkState(header.network)))throw fail('INVALID_NETWORK_STATE','Native network state is invalid or unsupported for this profile.');
        this._header = validateAudioState(validateAppState(validateMediaState(header, this._prepared.profile, this.appId),this._prepared.profile,this.appId),this._prepared.profile); this._buffer = this._buffer.subarray(newline + 1);
      }
      if (this._buffer.length < pixels) return;
      if (this._buffer.length > pixels) throw fail('UNSOLICITED_FRAME', 'Unexpected bytes followed the native framebuffer.');
      const rgb = this._buffer, png = encodeNativePng(rgb, width, height);
      if(appCapabilities(this._header,this._prepared.profile,this.appId).captureHandshake){
        for(const id of [this._header.capture_intent?.id,this._header.recording_capture?.id,this._header.recording?.id].filter(Boolean)){
          if(!this._captureIds.has(id)&&this._captureIds.size>=64)throw fail('CAPTURE_LIMIT','Capture identity history is full. Reload the app before another recording.');
          this._captureIds.add(id);
        }
      }
      this._state = this._header; this._revision += 1;
      if(this._audioStream&&(!this._state.audio_input?.active||this._state.audio_input.stream_id!==this._audioStream.id)){this._audioStream.active=false;clearTimeout(this._audioTimer);this._audioTimer=null;}
      this._frame = { id: this._revision, width, height, mimeType: 'image/png', png, sha256: digest(png), rgbSha256: digest(rgb) };
      this._buffer = Buffer.alloc(0); this._header = null; this._status = 'running'; this._error = null;
      const pending = this._pending; this._pending = null; clearTimeout(pending.timer); pending.resolve(this.snapshot());
      queueMicrotask(()=>this._pumpNetwork());
    } catch (error) { this._markFailed(error instanceof NativeSessionError ? error : fail('INVALID_FRAME', 'Native framebuffer could not be decoded.')); }
  }
  _pumpNetwork() {
    if(this._status!=='running')return;
    const p=this._state?.network_adapter===1?this._state.network?.pending:null;
    if(this._networkActive?.id===p?.id)return;
    this._networkActive?.controller.abort();this._networkActive=null;
    if(!p)return;
    const job={id:p.id,controller:new AbortController()};this._networkActive=job;
    this._network.perform(p,job.controller.signal).then(result=>{
      if(this._networkActive!==job||job.controller.signal.aborted)return;
      return this._enqueue(async()=>{
        if(this._networkActive!==job||this._state?.network?.pending?.id!==p.id)return;
        const hex=result.body?Buffer.from(result.body,'utf8').toString('hex'):'-';
        await this._command(`network_result ${p.id} ${result.link} host ${result.status} ${result.error||'-'} ${hex}\n`);
      },true); // One reserved result slot: never replay an HTTP operation under input backpressure.
    }).catch(()=>{if(this._networkActive===job&&this._status==='running')this._markFailed(fail('NETWORK_ADAPTER_FAILED','The network adapter stopped. Reload the emulator to recover.'));});
  }
  snapshot() {
    const { width, height, primaryInput, motion } = this._prepared.profile;
    const media = {...mediaCapabilities(this._state, this._prepared.profile, this.appId),...appCapabilities(this._state,this._prepared.profile,this.appId),...audioCapabilities(this._state,this._prepared.profile)};
    return { sessionId: this.sessionId, profile: this.profileId, app: this.appId, width, height, status: this._status, revision: this._revision, buildId: this.buildId, sourceSha256: this._prepared.meta.source_sha256,
      capabilities: { primaryInput, touch: primaryInput === 'touch', motion, ...media,
        implementedInputs: ['primary', ...(media.secondaryButton?['secondary']:[]), ...(motion ? ['shake', 'tilt'] : []), 'reset', ...(media.microphone ? ['mic'] : []),
          ...(media.spatialTouch?['swipe']:[]),...(media.appAdapter?['text','image','image_clear']:[]),
          ...(media.recordingInput?['recording_start','recording','recording_clear']:[]),
          ...(media.captureHandshake?['recording_request','recording_stopped']:[]),...(media.powerButton?['power']:[])] },
      renderer: { status: this._status, exitCode: this._exitCode, message: this._error?.message ?? (this._status === 'stopped' ? 'Native preview stopped.' : 'Native renderer process is running.') },
      nativeState: this._state ? structuredClone(this._state) : null,
      frame: this._frame ? { ...this._frame, png: Buffer.from(this._frame.png) } : null };
  }
  _enqueue(operation, internalNetworkResult=false) {
    if (this._queued >= MAX_QUEUE && !internalNetworkResult) return Promise.reject(fail('QUEUE_FULL', 'Too many native inputs are queued. Wait before trying again.'));
    this._queued += 1;
    const result = this._tail.then(() => { if (this._status !== 'running') throw this._error ?? fail('SESSION_STOPPED', 'Native preview is not running. Reload to recover.'); return operation(); }).finally(() => { this._queued -= 1; });
    this._tail = result.catch(() => {}); return result;
  }
  // Internal transport primitive. Never expose this through an MCP/UI tool.
  async _command(bytes,audioRequest=null) {
    const response = this._expectFrame(audioRequest);
    // Attach rejection handling immediately, before a possible synchronous stream error.
    response.catch(() => {});
    try { this._child.stdin.write(bytes, error => { if (error) this._markFailed(fail('NATIVE_WRITE_FAILED', 'Native input failed. Reload to recover.')); }); }
    catch { this._markFailed(fail('NATIVE_WRITE_FAILED', 'Native input failed. Reload to recover.')); }
    return response;
  }
  _acceptAudioAck(header,request) {
    if(!exactKeys(header,['type','profile','app','stream_id','action','accepted','sequence','next_frame','requested','active'])||
      header.type!=='audio_ack'||header.profile!==this.profileId||header.app!==this.appId||header.stream_id!==request.streamId||header.action!==request.action||
      typeof header.accepted!=='boolean'||typeof header.requested!=='boolean'||typeof header.active!=='boolean'||
      (header.active&&!header.requested)||!validAudioPosition(header.sequence,header.next_frame))throw fail('INVALID_AUDIO_ACK','Native microphone acknowledgment is invalid.');
    const stream=this._audioStream;
    if(header.accepted){
      const expectedSequence=request.action==='start'?-1:request.action==='chunk'?request.sequence:stream?.sequence;
      const expectedFrame=request.action==='start'?0:request.action==='chunk'?request.firstFrame+request.frameCount:stream?.nextFrame;
      if(header.sequence!==expectedSequence||header.next_frame!==expectedFrame||
        (request.action==='start'&&!header.active)||(request.action==='stop'&&header.active))throw fail('INVALID_AUDIO_ACK','Native microphone acknowledgment does not match the submitted operation.');
      if(request.action==='start')this._audioStream={id:request.streamId,source:request.source,startedAt:Date.now(),active:true,sequence:-1,nextFrame:0,partial:false};
      else {stream.sequence=header.sequence;stream.nextFrame=header.next_frame;stream.active=header.active;if(request.action==='chunk'&&request.frameCount<MAX_AUDIO_FRAMES)stream.partial=true;}
      this._state={...this._state,audio_input:{...this._state.audio_input,requested:header.requested,active:header.active,stream_id:request.streamId,
        source:this._audioStream.source,sequence:header.sequence,next_frame:header.next_frame}};
    }else if(stream&&stream.id===request.streamId){
      if(header.sequence!==stream.sequence||header.next_frame!==stream.nextFrame)throw fail('INVALID_AUDIO_ACK','Rejected microphone input changed the accepted position.');
      stream.active=header.active;
      this._state={...this._state,audio_input:{...this._state.audio_input,requested:header.requested,active:header.active}};
    }
    this._scheduleAudioExpiry();
    return {sessionId:this.sessionId,streamId:request.streamId,action:request.action,accepted:header.accepted,
      sequence:header.sequence,nextFrame:header.next_frame,requested:header.requested,active:header.active,revision:this._revision};
  }
  _scheduleAudioExpiry() {
    clearTimeout(this._audioTimer);this._audioTimer=null;
    const stream=this._audioStream;
    if(!stream?.active||this._status!=='running')return;
    const remaining=Math.max(0,Math.min(5000,MAX_AUDIO_LIFETIME_MS-(Date.now()-stream.startedAt)));
    this._audioTimer=setTimeout(()=>{
      if(this._audioStream!==stream)return;
      stream.expired=true;this._expireAudio();
    },remaining);
    this._audioTimer.unref?.();
  }
  _expireAudio() {
    const stream=this._audioStream;
    if(!stream?.expired||!stream.active||stream.cleanupStarted||this._audioBusy||this._status!=='running')return;
    stream.cleanupStarted=true;
    void this.audio({sessionId:this.sessionId,streamId:stream.id,action:'stop'}).then(ack=>{
      if(!ack.accepted||ack.active)throw fail('AUDIO_STOP_FAILED','Expired microphone cleanup was not confirmed.');
    }).catch(()=>{
      if(this._status==='running')this._markFailed(fail('AUDIO_STOP_FAILED','Expired microphone cleanup was not confirmed.'));
      // A failed stop is never retried; closing the owned worker terminates input.
      void this.close().catch(()=>{});
    });
  }
  _validateAudioRequest(request) {
    if(request.sessionId!==this.sessionId)throw fail('STALE_SESSION','Microphone input belongs to an earlier preview session.');
    if(!audioCapabilities(this._state,this._prepared.profile).microphonePcm)throw fail('UNSUPPORTED_AUDIO','This app and profile do not expose native PCM microphone input.');
    const current=this._audioStream;
    if(request.action==='start'){
      if(this._state.audio_input?.active||current?.active)throw fail('AUDIO_BUSY','Stop the active microphone stream before starting another.');
      if(!this._state.audio_input?.requested)throw fail('AUDIO_NOT_REQUESTED','The app has not requested microphone input.');
      if(this._audioIds.has(request.streamId))throw fail('STALE_AUDIO_STREAM','Microphone stream identities cannot be reused.');
      if(this._audioIds.size>=64)throw fail('AUDIO_LIMIT','Reload the app before starting another microphone stream.');
    }else{
      if(!current||current.id!==request.streamId)throw fail('STALE_AUDIO_STREAM','Microphone input belongs to an earlier stream.');
      if(request.action==='chunk'){
        if(!current.active||!this._state.audio_input?.active||!this._state.audio_input?.requested)throw fail('AUDIO_NOT_REQUESTED','The app is no longer accepting microphone input.');
        if(current.partial||request.sequence!==current.sequence+1||request.firstFrame!==current.nextFrame)throw fail('AUDIO_ORDER','Microphone chunks must be ordered and contiguous.');
        if(current.expired||Date.now()-current.startedAt>=MAX_AUDIO_LIFETIME_MS||request.firstFrame+request.frameCount>MAX_AUDIO_TOTAL_FRAMES)throw fail('AUDIO_LIMIT','The bounded microphone session has ended.');
      }
    }
  }
  _audioInactiveAck(request,error) {
    const stream=this._audioStream;
    if(error?.code!=='AUDIO_NOT_REQUESTED'||request?.action!=='chunk'||!stream||stream.id!==request.streamId||
      this._state.audio_input?.requested!==false||request.sequence!==stream.sequence+1||request.firstFrame!==stream.nextFrame)return null;
    stream.active=false;clearTimeout(this._audioTimer);this._audioTimer=null;
    return {sessionId:this.sessionId,streamId:stream.id,action:'chunk',accepted:false,sequence:stream.sequence,nextFrame:stream.nextFrame,requested:false,active:false,revision:this._revision};
  }
  audio(args={}) {
    let request,pcm=null;
    try {
      const required=['sessionId','streamId','action'];
      if(!args||!['start','chunk','stop'].includes(args.action)||!exactKeys(args,[...required,...(args.action==='start'?['source']:args.action==='chunk'?['sequence','firstFrame','pcmBase64']:[])])||
        !assetId(args.streamId))throw fail('INVALID_AUDIO','Malformed bounded microphone operation.');
      request={sessionId:args.sessionId,streamId:args.streamId,action:args.action};
      if(args.action==='start'){
        if(!['browser','fixture'].includes(args.source))throw fail('INVALID_AUDIO','Microphone source must be browser or fixture.');
        request.source=args.source;
      }else if(args.action==='chunk'){
        if(!Number.isSafeInteger(args.sequence)||args.sequence<0||args.sequence>=MAX_AUDIO_TOTAL_FRAMES||!Number.isSafeInteger(args.firstFrame)||args.firstFrame<0||args.firstFrame>=MAX_AUDIO_TOTAL_FRAMES||
          typeof args.pcmBase64!=='string'||args.pcmBase64.length<4||args.pcmBase64.length>Math.ceil(MAX_AUDIO_FRAMES*2/3)*4)throw fail('INVALID_AUDIO','Microphone chunk exceeds the fixed PCM bounds.');
        pcm=Buffer.from(args.pcmBase64,'base64');
        if(pcm.length<2||pcm.length>MAX_AUDIO_FRAMES*2||pcm.length%2||pcm.toString('base64')!==args.pcmBase64)throw fail('INVALID_AUDIO','Microphone bytes do not match canonical PCM16.');
        request.sequence=args.sequence;request.firstFrame=args.firstFrame;request.frameCount=pcm.length/2;
      }
      this._validateAudioRequest(request);
      if(this._audioBusy)throw fail('AUDIO_BUSY','Only one microphone operation may be outstanding.');
    }catch(error){pcm?.fill(0);const inactive=this._audioInactiveAck(request,error);return inactive?Promise.resolve(inactive):Promise.reject(error);}
    this._audioBusy=true;
    const result=this._tail.then(async()=>{
      if(this._status!=='running')throw this._error??fail('SESSION_STOPPED','Native preview is not running.');
      try{this._validateAudioRequest(request);}catch(error){const inactive=this._audioInactiveAck(request,error);if(inactive)return inactive;throw error;}
      if(request.action==='start')this._audioIds.add(request.streamId);
      let bytes;
      if(request.action==='chunk')bytes=Buffer.concat([Buffer.from(`audio_chunk ${request.streamId} ${request.sequence} ${request.firstFrame} ${request.frameCount}\n`),pcm]);
      else bytes=Buffer.from(request.action==='start'?`audio_start ${request.streamId} ${request.source}\n`:`audio_stop ${request.streamId}\n`);
      try{return await this._command(bytes,request);}finally{bytes.fill(0);}
    }).finally(()=>{pcm?.fill(0);this._audioBusy=false;this._expireAudio();});
    this._tail=result.catch(()=>{});return result;
  }
  refresh() { return this._enqueue(() => this._command(Buffer.from('state\n'))); }
  _eventCommand(event,{validateState=true}={}) {
    if (!event || typeof event !== 'object') throw fail('INVALID_INPUT', 'Expected a supported input object.');
    const { width, height, primaryInput } = this._prepared.profile;
    const adapter=appCapabilities(this._state,this._prepared.profile,this.appId);
    if(event.type==='secondary'){
      if(!exactKeys(event,['type','durationMs'])||!Number.isInteger(event.durationMs)||event.durationMs<0||event.durationMs>60000)throw fail('INVALID_INPUT','Button B requires a bounded press duration.');
      if(!adapter.secondaryButton)throw fail('UNSUPPORTED_INPUT','This app/profile has no supported B button. Rebuild an older workspace before using it.');
      return `secondary ${event.durationMs}\n`;
    }
    if(event.type==='power'){
      if(!exactKeys(event,['type','action'])||!['click','hold'].includes(event.action))throw fail('INVALID_INPUT','POWER requires an explicit click or hold action.');
      if(!adapter.powerButton)throw fail('UNSUPPORTED_INPUT','This app and profile do not expose the simulated POWER input.');
      return `power ${event.action}\n`;
    }
    if(['text','recording','recording_request','recording_start','recording_stopped','recording_clear','image','image_clear'].includes(event.type)){
      if(!adapter.appAdapter)throw fail('UNSUPPORTED_INPUT','Rebuild this custom app with the app asset adapter.');
      const resultPrefix=()=>{
        const expected=nativeResult(this._state.expected_result),ctx=event.context;
        if(!validateState){if(ctx===undefined)return '';if(!validResultContext(ctx))throw fail('INVALID_INPUT','Result context is malformed.');return `${ctx.draftId} ${ctx.requestId} ${ctx.revision} `;}
        if(ctx===undefined&&!expected)return '';
        if(!validResultContext(ctx)||!expected||ctx.draftId!==expected.draftId||ctx.requestId!==expected.requestId||ctx.revision!==expected.revision)throw fail('STALE_RESULT','Result does not match the app’s current draft, request and revision.');
        return `${ctx.draftId} ${ctx.requestId} ${ctx.revision} `;
      };
      if(event.type==='text'&&exactKeys(event,['type','text'],['context'])){
        if(typeof event.text!=='string'||Buffer.byteLength(event.text)<1||Buffer.byteLength(event.text)>2048||event.text.includes('\0'))throw fail('INVALID_INPUT','Text must contain 1–2048 UTF-8 bytes without NUL.');
        const bytes=Buffer.from(event.text);if(new TextDecoder('utf-8',{fatal:true}).decode(bytes)!==event.text)throw fail('INVALID_INPUT','Text must be valid UTF-8.');
        const prefix=resultPrefix();return `${prefix?'text_result':'text'} ${prefix}${bytes.toString('hex')}\n`;
      }
      if(['recording_request','recording_start','recording_stopped'].includes(event.type)&&exactKeys(event,['type','id','source'])){
        if(!adapter.recordingInput)throw fail('UNSUPPORTED_INPUT','Capture acknowledgment requires a microphone profile.');
        if(!assetId(event.id)||!['browser','fixture'].includes(event.source))throw fail('INVALID_INPUT','Capture acknowledgment requires a bounded ID and explicit source.');
        if(event.type!=='recording_start'&&!adapter.captureHandshake)throw fail('UNSUPPORTED_INPUT','This app does not implement the capture handshake.');
        if(adapter.captureHandshake&&validateState){
          const capture=this._state.recording_capture,intent=this._state.capture_intent,recording=this._state.recording;
          const matches=value=>value?.id===event.id&&value?.source===event.source;
          if(event.type==='recording_request'){
            const samePending=intent?.action==='start'&&matches(intent);
            if(capture||(intent?.action==='start'&&!samePending))throw fail('CAPTURE_BUSY','Finish or cancel the active capture before recording again.');
            if(!samePending&&this._captureIds.has(event.id))throw fail('STALE_RECORDING','Capture identities cannot be reused. Start a new recording.');
            if(!samePending&&this._captureIds.size>=64)throw fail('CAPTURE_LIMIT','Capture identity history is full. Reload the app before another recording.');
          }else if(event.type==='recording_start'){
            if(!((matches(intent)&&intent.action==='start')||(matches(capture)&&capture.stopped===false)))throw fail('STALE_RECORDING','Capture start no longer matches the app’s pending intent.');
          }else if(!matches(capture)&&!matches(recording))throw fail('STALE_RECORDING','Capture stop no longer matches an active or completed recording.');
        }
        return `${event.type} ${event.id} ${event.source}\n`;
      }
      if(event.type==='recording'&&exactKeys(event,['type','recording'])){
        if(!adapter.recordingInput||!validRecording(event.recording))throw fail('INVALID_INPUT','Recording requires bounded metadata and a microphone profile. Audio bytes are never accepted.');
        const r=event.recording,capture=this._state.recording_capture;
        if(validateState&&(!capture||capture.id!==r.id||capture.source!==r.source||(adapter.captureHandshake&&capture.stopped!==true)))throw fail('STALE_RECORDING','Recording was cancelled, reset, replaced or not acknowledged stopped before completion.');
        return `recording ${r.id} ${r.duration_ms} ${r.bytes} ${audioMimes[r.mime_type]} ${r.sha256} ${r.source}\n`;
      }
      if(event.type==='image'&&exactKeys(event,['type','id','width','height','pixelsBase64'],['context'])){
        if(!assetId(event.id)||!Number.isInteger(event.width)||!Number.isInteger(event.height)||event.width<1||event.height<1||event.width>width||event.height>height||typeof event.pixelsBase64!=='string'||event.pixelsBase64.length>204800)throw fail('INVALID_INPUT','Image must fit the exact display and bounded RGB565 format.');
        const bytes=Buffer.from(event.pixelsBase64,'base64');
        if(bytes.length!==event.width*event.height*2||bytes.toString('base64')!==event.pixelsBase64)throw fail('INVALID_INPUT','Image bytes do not match canonical RGB565 geometry.');
        let hex='';for(let i=0;i<bytes.length;i+=2)hex+=bytes.readUInt16LE(i).toString(16).padStart(4,'0');
        const prefix=resultPrefix();return `${prefix?'image_result':'image'} ${prefix}${event.id} ${event.width} ${event.height} ${hex}\n`;
      }
      if(event.type==='recording_clear'&&exactKeys(event,['type'],['id','source'])){
        if(!adapter.recordingInput)throw fail('UNSUPPORTED_INPUT','Recording cleanup requires a microphone profile.');
        const scoped=Object.hasOwn(event,'id')||Object.hasOwn(event,'source');
        if(!scoped)return 'recording_clear\n';
        if(!adapter.captureHandshake)throw fail('UNSUPPORTED_INPUT','Scoped cleanup requires the capture handshake.');
        if(!assetId(event.id)||!['browser','fixture'].includes(event.source))throw fail('INVALID_INPUT','Scoped cleanup requires both capture ID and source.');
        if(validateState&&![this._state.capture_intent,this._state.recording_capture,this._state.recording].some(value=>value?.id===event.id&&value?.source===event.source))
          throw fail('STALE_RECORDING','Recording cleanup belongs to an earlier capture.');
        return `recording_clear ${event.id} ${event.source}\n`;
      }
      if(event.type==='image_clear'&&exactKeys(event,['type']))return 'image_clear\n';
      throw fail('INVALID_INPUT','Malformed app asset input.');
    }
    if(event.type==='swipe'&&exactKeys(event,['type','x','y','endX','endY','durationMs'])){
      if(!adapter.spatialTouch||![event.x,event.y,event.endX,event.endY,event.durationMs].every(Number.isInteger)||event.x<0||event.endX<0||event.x>=width||event.endX>=width||event.y<0||event.endY<0||event.y>=adapter.touchHeight||event.endY>=adapter.touchHeight||event.durationMs<0||event.durationMs>60000)throw fail('INVALID_INPUT','Swipe requires supported touch-surface coordinates and a spatial touch app.');
      return `swipe ${event.x} ${event.y} ${event.endX} ${event.endY} ${event.durationMs}\n`;
    }
    if (event.type === 'primary' && exactKeys(event, ['type', 'durationMs'], ['x', 'y'])) {
      if (!Number.isInteger(event.durationMs) || event.durationMs < 0 || event.durationMs > 60000) throw fail('INVALID_INPUT', 'Press duration must be 0–60000 milliseconds.');
      const hasX = Object.hasOwn(event, 'x'), hasY = Object.hasOwn(event, 'y');
      if (hasX !== hasY || (primaryInput !== 'touch' && hasX)) throw fail('INVALID_INPUT', 'Coordinates require a supported touch profile.');
      if (primaryInput === 'touch') {
        const x = hasX ? event.x : Math.floor(width / 2), y = hasY ? event.y : Math.floor(height / 2);
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= adapter.touchHeight) throw fail('INVALID_INPUT', 'Touch coordinates must be inside the supported touch surface.');
        return `touch ${x} ${y} ${event.durationMs}\n`;
      }
      return `button ${event.durationMs}\n`;
    }
    if (event.type === 'tilt' && exactKeys(event, ['type', 'degrees'])) {
      if (typeof event.degrees !== 'number' || !Number.isFinite(event.degrees) || event.degrees < -60 || event.degrees > 60) throw fail('INVALID_INPUT', 'Tilt must be finite and between -60 and 60 degrees.');
      if (!this._prepared.profile.motion) throw fail('UNSUPPORTED_INPUT', 'This exact device profile has no motion input.');
      const radians = event.degrees * Math.PI / 180;
      return `motion 0 ${Math.sin(radians).toFixed(9)} ${Math.cos(radians).toFixed(9)}\n`;
    }
    if (['shake', 'reset'].includes(event.type) && exactKeys(event, ['type'])) {
      if (event.type === 'shake' && !this._prepared.profile.motion) throw fail('UNSUPPORTED_INPUT', 'This exact device profile has no motion input.');
      return `${event.type}\n`;
    }
    if (event.type === 'mic' && exactKeys(event, ['type', 'level', 'source'])) {
      if (typeof event.level !== 'number' || !Number.isFinite(event.level) || event.level < 0 || event.level > 1 ||
          !['fixture', 'browser'].includes(event.source))
        throw fail('INVALID_INPUT', 'Microphone input requires a normalized level and fixture or browser source.');
      if (!mediaCapabilities(this._state, this._prepared.profile, this.appId).microphone)
        throw fail('UNSUPPORTED_INPUT', 'Microphone level input requires a supported profile and a rebuilt media adapter.');
      return `mic ${(event.level * 100).toFixed(6)} ${event.source}\n`;
    }
    throw fail('INVALID_INPUT', 'This input is not implemented by the current preview adapter.');
  }
  input({ sessionId, requestId, event } = {}) {
    if (sessionId !== this.sessionId) return Promise.reject(fail('STALE_SESSION', 'Input belongs to a previous preview session.'));
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(requestId)) return Promise.reject(fail('INVALID_REQUEST_ID', 'A bounded unique request ID is required.'));
    let command,eventCopy;
    try { eventCopy=structuredClone(event);command = this._eventCommand(eventCopy,{validateState:false}); } catch (error) { return Promise.reject(error); }
    const fingerprint = digest(command), cached = this._dedupe.get(requestId);
    if (cached) return cached.fingerprint === fingerprint ? cached.result.then(() => this.snapshot()) : Promise.reject(fail('REQUEST_ID_REUSED', 'Request ID was reused for a different action.'));
    // Reject before reserving an ID when no action was queued.
    if (this._queued >= MAX_QUEUE) return Promise.reject(fail('QUEUE_FULL', 'Too many native inputs are queued. Wait before trying again.'));
    // A preceding queued reset/cancel may invalidate an async result. Recheck
    // at execution time so a stale result cannot reach or terminate the worker.
    const result = this._enqueue(() => this._command(Buffer.from(this._eventCommand(eventCopy))));
    // Cache only completion/failure, not 64 full framebuffer snapshots.
    const completion = result.then(() => undefined);
    this._dedupe.set(requestId, { fingerprint, result: completion });
    completion.catch(() => {});
    while (this._dedupe.size > MAX_DEDUPE) this._dedupe.delete(this._dedupe.keys().next().value);
    return result;
  }
  close() {
    if (this._closePromise) return this._closePromise;
    this._closePromise = this._close(); return this._closePromise;
  }
  async _close() {
    this._status = 'stopped'; this._error = null;
    this._markFailed(fail('SESSION_STOPPED', 'Native preview stopped.'));
    const child = this._child;
    if (!child) return;
    // Destroy drops queued writes and closes the pipe without waiting for drain.
    child.stdin.destroy();
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise(resolve => {
        let finished = false;
        const done = () => { if (finished) return; finished = true; clearTimeout(grace); clearTimeout(deadline); child.off('exit', done); resolve(); };
        const grace = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, Math.min(500, this.closeTimeoutMs / 2));
        const deadline = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} done(); }, this.closeTimeoutMs);
        child.once('exit', done);
      });
    }
    child.stdout.destroy(); child.stderr.destroy();
    if (child.exitCode === null && child.signalCode === null) throw fail('CLOSE_TIMEOUT', 'Native worker did not confirm exit within the cleanup deadline.');
    this._buffer = Buffer.alloc(0); this._header = null;
  }
}
