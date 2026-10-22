# App-owned speaker PCM

CoreS3, CoreS3 SE and StickS3 native apps can play arbitrary signed mono PCM16 samples with `UserApp::playPcm(samples, frames, sampleRate)` and stop with `stopSpeaker()`. The input range is 8,000–48,000 Hz, one clip at a time, at most 30 seconds. A play copies the app buffer, replaces the previous clip and clears the tone intent. Return false means unsupported profile or invalid bounds. Buzzer-only StickC Plus2 uses `requestSound`; AtomS3R refuses output. Existing apps without `speakerOutput()` retain tone-only behavior.

```cpp
// On an app-defined touch/button event; samples are app assets or generated audio.
if (!playPcm(effect.data(), effect.size(), 24000)) {
    // Show an app-owned unsupported/bounds error if appropriate.
}
// On the app's stop button:
stopSpeaker();
```

## Flow

App samples → generic SpeakerOutput → native packet → validated local MCP metadata → browser AudioBuffer → computer speaker. No provider, audio upload, URL loading or API key is involved. PCM bytes are omitted from model-visible content and carried in app metadata. The browser uses the declared sample rate and converts signed little-endian integers to floats by dividing by 32768; volume is applied at the host gain node.

The native renderer emits up to 250 ms per packet, at most 12,000 frames/32,000 base64 characters. The native frame header is bounded to 40 KiB on speaker profiles, selected from the shared device registry. Sequence and generation identities prevent repeated snapshots replaying audio. Polling runs at 80 ms while the app clip is active, including while holding a device gesture; other apps retain normal polling. Browser scheduling bounds ahead-of-time audio and node count. Delayed frames are dropped after a transport pause instead of replaying a stale backlog; Runtime reports scheduling discontinuities. This is interactive simulation, not sample-clock synchronization with ESP32 hardware.

For record-then-play apps, accept the final input block, withdraw microphone demand, and wait for the inactive callback. Queue playback there, then call `playPcm()` on the next normal app tick. Audio acknowledgments do not emit a speaker frame; starting its clock inside that callback can let a delayed first frame trim the beginning of the clip. Cancel pending playback when the app is cancelled or interrupted. On hardware, keep microphone and speaker I/O exclusive.

Sound is on by default, but browser audio starts only from a device gesture. Before activation Audio settings shows “Ready · tap device.” Explicit Mute stays selected through app reload, profile changes and hide/show within this view. A fresh page starts with the default preference again. A new clip replaces queued output; app stop clears it; mute, hide, reload, profile/session replacement and error release browser sources. Volume changes affect an in-flight clip. Enabling sound does not replay a completed clip. The generic microphone path remains independent and touch/button interaction continues during playback.

## Scope

Supported: effects, recorded speech, sampled music and generated waveforms after conversion to bounded mono PCM. Not implemented: compressed-media decoding, indefinite live PCM streaming, stereo spatial output, hardware amplifier simulation or deterministic browser latency. Longer assets must be segmented by application code; gapless indefinite streaming needs a future queue/backpressure API, not an app-specific UI workaround.

CoreS3 SE and StickS3 also have physical speaker adapters; follow the [hardware workflow](hardware-workflow.md) for their limits and deployment checks. CoreS3 standard and StickC Plus2 remain emulator-only. AtomS3R has no onboard audio. The application defines its own controls; no sound demo is part of onboarding.
