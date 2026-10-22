# Native app authoring contract

`counter` (Hello World) and `custom` (My device app) share the editable `UserApp` model and native drawing. Work in a separate project; keep the installed plugin read-only. Workspace-free **Input preview** is illustrative JavaScript, not execution of your source. Open a built project in **Native app** mode before claiming an edit appears in the running app.

| File | Purpose |
| --- | --- |
| `src/user_app.hpp` | Application state, event handling, assets and result expectations |
| `src/user_draw.hpp` | `drawUserApp(display, app)` renders into the native framebuffer |
| `src/app_assets.hpp` | Bounded recording metadata, image and result-context types; image drawing helper |
| `src/device_model.hpp` | Exact profile capabilities and semantic InputEvent |
| `src/live_audio.hpp` | Opted-in borrowed PCM microphone blocks and bounded stream lifecycle |
| `app-manifest.json` | Declarative authoring metadata; does not execute files or register tools |

Preserve `UserApp(DeviceProfile)`, `device()`, `snapshot()`, `apply(InputEvent)`, `appSound()`, `recording()`, `image()`, `expectedResult()` and the asset/result setters below. Retain the starter diagnostic snapshot fields `title`, `count`, `alternate`, `tilt_degrees`, `tilt_source`, `microphone_amplitude` and `revision`. Add private app state and draw it directly; no app-specific panel or protocol extension is needed.

Keep app code portable across desktop and ESP32 compilers. Fixed-width types such as `std::uint32_t` can alias different underlying integer types; use explicit template types or matching operands in `std::min`/`std::max`. A successful native build does not replace the exact-board firmware build. Keep the model, drawing and assets identical across both builds.

## Fixed emulator, app-owned experience

Keep one emulator shell across every application. An app owns its screen, hit regions, button actions, recording controls, processing state, errors, and results. Render these in the native framebuffer and drive them through the actual device's supported touch/buttons. Do not add an app-specific browser page, external Record/Send workflow, transcript panel, or sample-dependent HTML to the emulator. Changes to the shell are for generic device inputs/outputs, selectors, lifecycle, and shared host settings only. Audio settings stay compact and visible below the device; read-only technical diagnostics belong in Runtime.

A completed device gesture can silently prepare the browser audio context. Actual capture still requires the native app's `audioInputRequested()` flag and browser/OS permission. Never grant permission from code or restart after hide/denial without another gesture. A generic host microphone override is diagnostic, not a required application step. Application services such as transcription belong in trusted app-specific backend code with bounded I/O and matching result contexts; the microphone peripheral only supplies PCM. Use the same shell in Chrome now and Codex when the host supports microphone access. Do not claim physical firmware fidelity from native simulation.

## Device and input contract

Exact profiles are `atoms3r` 128×128, `stickcplus2` and `sticks3` 135×240, `cores3` 320×240 and `cores3se` 320×240. SE has touch, microphone and speaker capability but no motion/camera. LCD touch is x0–319/y0–239. On exact SE, `UserApp::touch_strip_adapter = 1` opts the app into lower-strip coordinates y240–279; the worker advertises `touch_strip_adapter:1` and the supervisor exposes `touchStrip:true`, `touchWidth:320`, `touchHeight:280`. Older authored apps omit that marker and stay inside the display. The framebuffer and image bounds remain 320×240. StickS3 K150 is distinct from StickC Plus2; other Atom/Core variants are not aliases.

`InputEvent` preserves `kind`, `value`, `source`, followed by `x`, `y`, `duration_ms`, `text`, `asset_id`, `end_x`, `end_y`, `draft_id`, `request_id` and `revision`.

| Kind | App-visible payload and behavior |
| --- | --- |
| `PrimaryClick`, `HoldReset` | Atom/Stick completed primary input; starter short action adds 1 and a ≥1000 ms hold resets |
| `SecondaryClick`, `SecondaryHold` | StickC Plus2 B / StickS3 KEY2; requires `secondary_button_adapter = 1`. Starter click changes accent color; hold resets. |
| `TouchTap` | Completed touch x/y and duration; your app owns hit regions and hold policy |
| `TouchSwipe` | Start x/y, end_x/end_y and duration; one completed event, no raw drag/multi-touch stream |
| `PowerClick`, `PowerHold` | Distinct semantic POWER actions on CoreS3/SE counter/custom workers advertising `power_button_adapter:1`; no hardware timing, shutdown or bootloader emulation |
| `Shake`, `Tilt` | Synthetic motion only on capable profiles; SE rejects both |
| `MicrophoneAmplitude` | Normalized 0..1 level; starter stores it without changing the count |
| `RecordingStartRequested` | Legacy authored-app capture request; no shared-shell Record button; asset_id is a proposed ID and text is browser/fixture source. The app may choose its own ID in a start intent |
| `RecordingStarted` | Actual capture acknowledgment, or a prepared synthetic fixture; exact app-selected asset_id/source. It never requests microphone activation |
| `RecordingStopped` | Matching capture resources stopped, before Ready; asset_id and source are scoped to that capture |
| `RecordingReady`, `RecordingCleared` | Recording metadata lifecycle; ready metadata is stored before `apply()` |
| `ImageReady`, `ImageCleared` | Native image lifecycle; pixels are stored before `apply()` |
| `TextInput` | 1–2048 valid UTF-8 bytes in text; a fixture or approved result, never evidence of transcription by itself |

Cancelled pointer/key gestures produce no action. Native `counter`/`custom` workers must advertise `app_adapter:1` for the new generic inputs; old workers stay disabled until rebuilt. `media_adapter:1` separately gates mic levels and tones. The stock starter maps held TouchTap to reset and ignores swipe; authored apps may implement their own behavior.

## Live microphone input

The [microphone API](microphone-input.md) adds fixed 16 kHz mono PCM16 input for exact StickC Plus2, StickS3, CoreS3 and CoreS3 SE profiles. Apps opt in with `audio_input_adapter = 1` and the declared callbacks; `audioInputRequested()` expresses app demand separately from the device gesture and browser permission. Hello World requests input at startup and draws a native meter and sample count without changing primary +1/reset. An app may stop requesting input or reject a block. Older apps do not acquire PCM capability by profile name alone.

This stream does not accumulate or upload an audio file and does not require transcription. Optional clip capture below remains a separate contract.

## Core POWER and reset controls

CoreS3 and CoreS3 SE physically have independent POWER and RST controls. POWER is a system key that firmware can observe through the PMIC/M5Unified BtnPWR interface. Their touch-derived BtnA/BtnB/BtnC regions are software mappings, not dedicated physical switches. The SE lower strip sends completed TouchTap/TouchSwipe events at y240–279 only to opted-in counter/custom apps. Use `touchSurfaceHeight(device)` when validating these coordinates. The default starter treats short strip taps like other taps; authored apps can use the x coordinate for A/B/C regions. M5Unified maps these regions using `(x * 614) >> 16`; the corresponding boundaries are 0–106, 107–213 and 214–319. No raw multitouch stream or physical calibration is claimed. [Official SE instructions](https://docs.m5stack.com/en/core/CoreS3-SE), [official CoreS3 instructions](https://docs.m5stack.com/en/core/CoreS3), [M5Unified button implementation](https://raw.githubusercontent.com/m5stack/M5Unified/master/src/M5Unified.inl).

Rebuilt compatible counter/custom workers advertise `power_button_adapter:1`; the host exposes `capabilities.powerButton:true`. The exact input is `{type:'power',action:'click'|'hold'}`, translated to native `power click` or `power hold` and the distinct `PowerClick`/`PowerHold` app events. Gate controls on the actual worker capability, selected profile and app; an old worker, Atom or Stick must not gain POWER support by name alone.

The shell POWER click and separate explicit POWER hold action select semantics directly: there is no timing threshold or duration payload. The default native Hello World accepts both as no-ops; authored apps may handle them. Input preview displays POWER click/hold feedback without changing the count or resetting state. No measured PMIC/GPIO press timing, physical power-off, supply loss or download/bootloader sequence is modeled. Keep these events separate from `PrimaryClick`, touch confirmation and `HoldReset`.

Native Reset app/RST routes both controls through supported reload/worker restart, creating a fresh preview session without requiring app acceptance. Authored in-app HoldReset remains separate and may be declined. Input preview already resets its local illustrative state. Supported Reload discards worker-local state and invalidates the old session; it does not itself delete or rewrite an app-owned persisted private draft, which the app may restore on startup. This is not an electrical hardware reset or a power-key event. On hardware, POWER/RST operating instructions still apply independently; preview behavior is not permission to reset or flash an attached device.

M5Unified is a hardware reference for these names and distinctions; this portable native worker does not implement the M5Unified runtime, PMIC, hardware touch-strip mapping or boot sequence.

## Assets in native memory

```cpp
struct RecordingInfo {
  std::string id, mime_type;
  unsigned duration_ms, bytes;
  std::string sha256, source; // source: browser | fixture
};
struct ImageFrame {
  std::string id;
  unsigned width, height;
  std::vector<std::uint16_t> rgb565;
};
struct ResultContext {
  std::string draft_id, request_id;
  std::uint64_t revision;
};
```

Asset/context IDs match `[A-Za-z0-9_-]{1,64}`; revisions are integers from 1 through 9007199254740991. Recording metadata requires duration 1–30000 ms, bytes 1–2097152, a lowercase SHA-256 and MIME `audio/webm`, `audio/ogg`, `audio/mp4` or `audio/wav`. These fields describe a private browser clip, not a native audio buffer or a retrievable file.

`recordingStarted(id, source)`, `recordingStopped(id, source)`, `setRecording(info)`, scoped `clearRecording(id, source)`, local convenience `clearRecording()`, `recordingCapture()` and `recording()` manage metadata. `setImage(frame, optionalContext)`, `clearImage()` and `image()` manage pixels. Images are at most 320×240 and cannot exceed the selected display; pixel count must equal width×height. Setters validate before changing state, store before Ready, and report asset acceptance independently of whether authored `apply()` handles the event. An accepted starter in-app HoldReset clears assets/capture identity and active result expectation. Supported Reload starts a fresh worker/session; panel Reset app/RST uses the same restart path.

`drawImage(display, frame, x, y, width, height)` draws RGB565 with nearest-neighbor scaling and clipping into the actual framebuffer. Preserve the image aspect ratio in the destination rectangle when distortion is unwanted. There is no browser image overlay replacing native drawing.

## Legacy recording metadata

The native recording/capture metadata methods remain compatible for authored apps, but the shared shell has no clip recorder, external Record/Send flow, synthetic audio controls or provider bridge. For new apps, use the live microphone PCM callback and manage bounded recording storage inside the app. User-facing recording/processing/consent controls belong on the device screen/buttons. Generic metadata is not proof of browser capture or permission.

## Speaker output

Read [speaker-output.md](speaker-output.md). Apps with `speakerOutput()` expose mono PCM16 on CoreS3/SE and StickS3; ordinary app code calls `playPcm()` / `stopSpeaker()`. The runtime and shell remain shared. Existing apps without the method keep their original tone contract.

## Match asynchronous results to the current draft

Call `expectResult(ResultContext{draft_id, request_id, revision})` before requesting a text/image result. Read `expectedResult()` for the current optional expectation; cancel with `clearExpectedResult()`. `setText(text, optionalContext)` and `setImage(frame, optionalContext)` accept a contextual result only when all three fields match. With no active expectation, only context-free explicit fixture input is accepted. With an active expectation, context-free delivery is rejected.

An accepted contextual result consumes the expectation **before** `apply()` runs, and copies its identity into the event. The app may then arm the next step. A text result and subsequent image result therefore need separate expectations. Duplicate/delayed results fail after consumption, cancellation, reset or replacement. No result acceptance implies an API call occurred.

The worker remembers at most 64 distinct contexts. Re-arming the currently active identical context is idempotent; previously consumed/cancelled contexts cannot be re-armed. History never evicts silently: the 65th distinct expectation fails and the app must ask for reload/recovery. An accepted starter in-app HoldReset clears the active expectation but retains history; supported reload starts a fresh worker/session and a new lifetime. Panel Reset app/RST uses the same restart path. Check the boolean return from `expectResult` and show an actionable app state if it fails.

The model-visible tools are:

```text
m5stack_set_text({sessionId, text, context?: {draftId, requestId, revision}})
m5stack_import_image({sessionId, relativePath: "media-fixtures/example.png",
                      fit?: "contain" | "cover",
                      context?: {draftId, requestId, revision}})
```

Tool context is camelCase; C++ fields/native expected_result are snake_case. Use the actual active session and expected context. The package has 14 generic tools, no voice-transfer/provider tools. Text and image results remain model-visible; native PCM input is App-only.

The native header may include app_input_accepted:null|true|false. The worker emits true after a successful text command and null for other commands. Require a fresh matching reply, an advanced revision and consumed expected_result before reporting app acceptance. Missing acknowledgment is not proof. Never infer external service success from pixels alone.

## Recording and image boundaries

The peripheral delivers local PCM; app code decides whether to retain samples and what to do with them. There is no transcription provider or API-key requirement in the base plugin. Application services require separate authorized implementation and configuration.

`m5stack_import_image` accepts a reviewed workspace PNG fixture and maps it to bounded native RGB565. It does not emulate a camera or SD card. Persistent display assets belong in app source/assets. Text/image async context validation still applies. Do not reintroduce testing widgets into the shared shell.
