# Fixed emulator and app development contract

## Ownership

Codex develops and loads the application. The user tests that application through the emulated device. App requests authorize app source/assets/services changes, not modifications to the shared shell, runtime, transport, profiles or peripheral contracts. Changes to the emulator itself require an explicit user request, including proposed test features. This is an authoring boundary, not technical write isolation.

The application owns its framebuffer, screen hit regions, button behavior, recording and provider consent, progress, errors and results. The shell supplies supported device inputs/outputs, device selection, lifecycle and shared host settings. Never make sample-specific HTML or an external recording/result UI.

## Development loop

1. Identify the exact device and current app requirements. Report unsupported peripherals before claiming compatibility.
2. Create or reuse an authorized workspace; edit `src/user_app.hpp`, `src/user_draw.hpp`, app assets and any trusted app-owned backend.
3. Build the selected profile with the existing runtime. Open the built workspace; reload after later builds. Do not edit the runtime to make an application-specific test pass.
4. Exercise app behavior through real supported virtual buttons/touch and peripheral APIs. Codex can provide bounded named fixtures through existing tools; fixtures are reported as fixtures.
5. Report native model/transport, real browser, provider and physical-device evidence separately. Run relevant checks once; repeat only for a change, failure or unresolved concern.

## Default shell

Keep the device picker, reload/stop, emulated device buttons/touch, supported shake/tilt and semantic POWER hold, compact microphone status and speaker mute/volume. The loaded app and technical diagnostics are read-only in Runtime. The device app controls microphone demand. Browser/OS consent remains separate, and the stop/lifecycle controls release capture.

Remove manual Image import, synthetic microphone/clip controls, test tone, external recording/send/transcript panels and the built-in app picker. Codex opens the requested app/workspace. Image injection remains an existing test tool, not a physical camera/SD adapter. The base package has no voice-transfer/provider tools. Generic recording metadata and scoped result interfaces remain available to application code.

## Fidelity and deployment scope

The simulator runs the portable C++ application, renders native framebuffer pixels and supplies supported inputs. It does not execute arbitrary ESP32 firmware or emulate every chip.

| Feature | Implemented scope | Limits |
|---|---|---|
| Display and app logic | Five native profiles; same app headers compile for three physical targets | Exact-board build/boot acceptance remains distinct from simulation |
| Touch/buttons | Profile-gated events, secondary key opt-in, SE lower strip, Core semantic POWER/RST | No electrical power/bootloader simulation |
| Microphone | Browser to 16 kHz mono PCM16 app callbacks on four profiles; physical SE/Stick capture tested | Browser/OS permission required; panel host capture unverified; no stereo/full-duplex promise |
| Speaker/buzzer | CoreS3/SE/StickS3 mono PCM16 clips; Plus2 buzzer | Physical SE/Stick playback tested; Stick loudness remains an issue |
| Images | App drawing plus Codex-injected RGB565 fixtures | Camera/storage adapters unimplemented |
| Motion | Semantic shake/tilt on supported profiles; Atom/Stick physical mapping tested | Not raw calibrated IMU emulation; SE has no IMU |
| Network | Optional named HTTP(S), GET/JSON POST, three firmware targets | Bounded messages; no audio upload, streaming or BLE |
| Deployment | Pinned build, private verified backup, exact-identity flash/restore and boot diagnostics for AtomS3R, StickS3 and SE | Standard CoreS3/Plus2 firmware targets unimplemented |

A native executable cannot be flashed. Use the same portable app source with the appropriate firmware adapter. Camera, SD/storage, GPIO/IR, raw radio, full RTC and battery behavior require additional contracts and validation. See [hardware workflow](hardware-workflow.md) and [hardware scope](hardware-plan.md).
