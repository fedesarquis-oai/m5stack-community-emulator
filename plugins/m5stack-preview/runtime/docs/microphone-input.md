# Native microphone input — current app contract

This adapter lets an authored native app consume the computer's microphone as a declared virtual input. It supports exact `stickcplus2`, `sticks3`, `cores3` and `cores3se` profiles. Plain `atoms3r` has no microphone. Older workers and apps without the interface below do not gain PCM input from hardware capability alone.

A completed device touch/button gesture prepares a silent audio context. App code independently decides whether it wants input; only app demand causes microphone acquisition, which remains subject to browser/OS permission. No separate external recording button is required. Hello World requests input at startup on microphone profiles and preserves primary +1/reset. An app can instead start with demand off and toggle it from its own screen/buttons. The shared Audio settings panel shows microphone status; native PCM apps start capture through device controls. Technical diagnostics live in Runtime.

Stopping the app, hiding the view, reset/reload, changing app/profile/session, disconnect, track loss or failure disarms capture. Returning does not automatically reopen the microphone. The app's request cannot grant host permission. Use the [local browser preview](browser-fallback.md) for current microphone development; Codex-panel support has a separate host restriction and validation record.

## App interface

Include `live_audio.hpp` and implement this interface in the editable `UserApp`:

```cpp
static constexpr unsigned audio_input_adapter = 1;
bool audioInputRequested() const;
void onMicrophoneState(bool active);
bool onMicrophoneBlock(const preview::AudioBlockView& block);
```

The marker and exact method signatures are required. `audioInputRequested()` is app demand, not permission. `onMicrophoneState` reports native stream activation/deactivation. `onMicrophoneBlock` returns true only after accepting the block; false ends that stream without advancing its accepted transport position. The starter's `requestMicrophone(bool)` updates app demand and rejects enabling unsupported profiles.

`AudioBlockView` contains:

| Field | Contract |
| --- | --- |
| `samples` | Borrowed `const std::int16_t*`; valid only during this callback |
| `frames` | 1–1600 mono samples |
| `sample_rate`, `channels` | Fixed 16000 Hz and 1 |
| `sequence`, `first_frame` | Zero-based contiguous chunk index and sample offset |
| `source` | `browser`, explicitly labeled `fixture`, or `device` from a supported physical firmware adapter |

Process samples during the callback. Copy only into explicitly bounded app-owned storage if the app needs it; do not retain the pointer or source reference. The browser explicitly downmixes and converts its input to mono PCM16. The native adapter accepts this fixed subset, without negotiating a codec or sample rate.

Apps may also implement `AudioInputStats audioInputStats() const`. Its `received_frames`, `level` and `active` describe app processing. Valid sample counts are at most 4,800,000 and levels are finite 0–1. The normal native header exposes `audio_input.received_frames` and `audio_input.level`, or null when the app does not provide valid stats. Hello World's values come from its callback, not the browser meter. `next_frame` is only the transport position; it must not be presented as independent proof that an app processed audio.

## Meter display

Both the browser meter and Hello World bar use a logarithmic −60 to 0 dBFS display. The percentage describes position on that scale, not microphone sensitivity or raw RMS. A raw RMS amplitude of 0.06 appears around 59%. Silence at or below 0.001 shows zero. This is a display-only curve; app statistics, PCM samples, capture and transport remain unchanged.

## Transport and lifecycle

The worker advertises `audio_input_adapter:1` and `audio_input.requested`. The supervisor exposes `capabilities.audioInputAdapter:1` and `microphonePcm:true` only for an opted-in worker and supported microphone profile. The fixed host requires this capability, a fresh device gesture (or diagnostic override), and app demand.

App-only `m5stack_audio` accepts:

```text
start: {sessionId, streamId, action:"start", source:"browser"|"fixture"}
chunk: {sessionId, streamId, action:"chunk", sequence, firstFrame, pcmBase64}
stop:  {sessionId, streamId, action:"stop"}
```

Chunks contain canonical base64 of signed PCM16 little-endian, with exactly two bytes per frame. Full chunks are 1600 frames/100 ms; a final partial chunk permits only Stop afterward. Stream IDs match `[A-Za-z0-9_-]{1,64}` and cannot be reused within a worker lifetime. History holds at most 64 IDs; reload is required at capacity. Wrong session/stream, out-of-order chunks and invalid lengths are rejected before app delivery.

The browser holds at most nine waiting chunks plus one in flight: a one-second / 32 KB PCM window for brief browser or transport stalls. Chunks are dispatched immediately, so this does not add a fixed one-second playback delay. There are no silent drops or automatic retransmissions. Overrun or timeout stops capture. A stream lasts at most five minutes/4,800,000 frames. The server stops an idle stream after five seconds without an accepted operation; a failed cleanup stop closes the owned worker rather than retrying audio. Stop cancels unsent browser chunks and waits for the one outstanding operation before native cleanup.

Acknowledgments contain only `{sessionId, streamId, action, accepted, sequence, nextFrame, requested, active, revision}`. The supervisor supplies the latest framebuffer `revision` at the audio operation, so an older frame cannot restart capture after a newer audio stop; a later app request can restart without requiring an intervening false frame. Older servers without this field use conservative demand-edge handling. Start uses sequence −1; chunks acknowledge the accepted sequence; Stop retains the last position. App withdrawal returns `accepted:false, requested:false, active:false` without advancing position. No PCM, transcript or pixels are returned. Native audio commands use a bounded JSON-line acknowledgment; independent state polling renders the framebuffer.

## Application services are separate

Live input does not upload a file or call a provider. The app owns recording storage and user controls on the native screen. The base plugin has no speech service, voice-transfer tools or API-key requirement. Application-specific services must be implemented separately when requested. Live audio travels through the local app bridge and native pipes; app-only visibility does not promise host non-retention.

This is not dual-microphone spatial simulation, I2S/PDM, a hardware codec/driver or physical-device validation. Browser input, Codex host permission and hardware acceptance remain separate; see [release validation](release-validation.md).
