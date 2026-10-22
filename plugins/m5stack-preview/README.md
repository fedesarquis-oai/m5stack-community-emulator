# M5Stack Community Emulator — v0.7.42

Build an M5Stack app with Codex, then interact with its screen and supported inputs in one fixed emulator. Codex edits app source, prepares assets, builds, loads and tests. App development does not modify the emulator unless the user explicitly requests an emulator extension.

## Included in the base plugin

- Profiles: AtomS3R C126, M5StickC Plus2, StickS3 K150, CoreS3 and exact CoreS3 SE.
- A shared MCP App/browser shell: device selection, supported buttons/touch/motion, reload/stop, compact audio status/mute/volume, read-only Runtime diagnostics.
- Local native C++ framebuffer builds and app input/result interfaces. The workspace-free input view is illustrative; a built workspace runs the user's native app code.
- Microphone PCM16 input at 16 kHz mono on the four microphone profiles, gated by app demand and browser/OS permission.
- App-authored mono speaker PCM16 at 8–48 kHz on CoreS3/SE and StickS3, plus existing tone output. StickC Plus2 keeps its buzzer and AtomS3R has neither microphone nor speaker.
- Optional networking on all five emulator profiles and three firmware targets: named HTTP(S) services, guided private USB setup, saved credentials, reconnect helper and forget operation. Atom has prior Wi-Fi acceptance; CoreS3 SE and StickS3 passed public GET/POST, saved-settings power cycles and forget/reprovision on October 20. See [networking](runtime/docs/network.md).
- Existing-project discovery through Codex: search M5Burner by exact board and requested feature, inspect original source and license, and credit upstream authors. See [project discovery](skills/m5stack-preview/references/project-discovery.md).
- Fourteen generic MCP tools for device guidance, prerequisites, builds, previews, input, PCM input, lifecycle, named test fixtures and physical deployment.

No transcription provider, API-key setup, speech sample service or voice-transfer tools are included. No cloud service is needed to use the emulator. Application-specific services belong to the application. The generated app workspace provides a technical scaffold. Users choose what to build; application demos and provider experiments stay outside this package.

## Use

Install the local plugin through a supported Codex marketplace, then tell Codex what you want to build. Codex should ask about your idea first if you have not supplied it, help select a supported device, create a separate workspace and build/test your app in Chrome. Hardware and community project research are optional. Existing approved Node 22+, Python, Git, Clang/Clang++ and platform headers are required for native builds. Native dependencies are prepared in an editable workspace, not inside the installed plugin. See [getting started](runtime/docs/getting-started.md).

For browser testing: `sh server/launch.sh --browser --workspace /absolute/prepared/workspace --profile cores3se --app custom`. This creates a temporary local URL lasting 30 minutes. Sound is on by default and activates with the first device interaction; the app controls what plays. Mute/Unmute and volume remain in Audio settings. Buttons and recording controls belong on the native device screen. Microphone capture stops on hide, reload, replacement or failure and requires another gesture to reconnect. Speaker playback also stops on hide, mute and replacement.

The Chrome microphone path is verified independently of Codex. Previously inspected Codex desktop builds reject microphone media access at the MCP App host layer. A plugin cannot override that restriction. The same shell is ready for a supported host permission flow; this release does not claim that Codex microphone access is fixed.

## Current limits

Speaker output accepts arbitrary sample content, with one mono clip at a time, up to 30 seconds. App code or Codex prepares/decodes assets into PCM; the shell does not decode arbitrary file formats. See [speaker API](runtime/docs/speaker-output.md) for buffering and timing limits. PCM is played on the computer, not a model of the physical amplifier or enclosure.

CoreS3 SE, AtomS3R and StickS3 have physically validated firmware workflows for their implemented features. CoreS3 standard and StickC Plus2 remain emulator-only. Camera, storage, GPIO, BLE, raw radio simulation, RTC and complete power/battery adapters remain unfinished. Networking uses the computer in simulation and the device Wi-Fi in firmware; a configured device calling a public API does not need a Mac server. GET and JSON POST are bounded; audio uploads/streaming are not included. The native executable cannot be flashed onto an ESP32. See [the hardware plan](runtime/docs/hardware-plan.md).

This is a community preview package. Installation is through its repository marketplace; it is not an official directory listing. Keep the existing plugin identity `m5stack-preview`. Preserve [runtime notices](runtime/THIRD_PARTY_NOTICES.md), [SDK notices](THIRD_PARTY_NOTICES.md) and licenses.

## Device support is a shared contract

All five profiles use `runtime/data/device-profiles.json`. Browser controls, MCP validation, the native build script and a generated C++ table consume that same registry. The bundle build refuses a stale generated table. Worker capabilities still gate individual adapters, so updating the host does not invent features in an older app binary.

| Device | App controls | Microphone | Output |
| --- | --- | --- | --- |
| AtomS3R C126 | Display-cap button | Absent | Absent |
| StickC Plus2 K016-P2 | A and B | PCM input | Buzzer tones |
| StickS3 K150 | KEY1 and KEY2 | PCM input | Speaker PCM and tones |
| CoreS3 K128 | Touch, semantic POWER | PCM input | Speaker PCM and tones |
| CoreS3 SE K128-SE | Touch including opted-in lower strip, semantic POWER | PCM input | Speaker PCM and tones |

Stick button placement is schematic; electrical power/reset, IR, GPIO, battery behavior and physical codec fidelity are not simulated. StickS3's system reset/power/download button is not routed as an application key. The simulator's Reset app action remains available.

App code handles `PrimaryClick`, `SecondaryClick` and `SecondaryHold` where supported. Add `static constexpr unsigned secondary_button_adapter = 1` when opting an older app into the second button. `audioInputRequested()` controls microphone demand; `playPcm()` supplies speaker samples; `requestSound()` supplies a bounded tone. Button A/KEY1 holds retain the existing semantic app-reset contract. The app implements the controls it needs without changing this shell.

## Physical-device deployment

Ask Codex to install the current app on a connected CoreS3 SE, AtomS3R C126 or StickS3 K150. The model-only hardware tool handles pinned setup, app capability checks, source-identical firmware builds, private verified backup, exact-device installation and boot diagnostics. Select the exact profile: memory settings and recovery receipts differ by board. See [hardware workflow](runtime/docs/hardware-workflow.md). CoreS3 SE and the initial StickS3 adapter use exclusive microphone/speaker I/O. AtomS3R supports display, button, semantic shake/tilt and optional Wi-Fi/HTTP(S), with no onboard audio. Other profiles remain emulator-only until individually implemented and validated. App demos and provider services remain separate.
