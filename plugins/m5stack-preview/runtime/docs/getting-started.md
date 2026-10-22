# Build your app with M5Stack Community Emulator

## Start with what you want to make

Tell Codex what you want your device app to do. If you have not described it yet, Codex should ask that first. It then helps you choose a supported device profile, creates a separate workspace, and builds and tests your app in Chrome. There is no required example app or community project to fork. You do not need physical hardware.

Supported profiles are AtomS3R C126 (`atoms3r`), M5StickC Plus2 (`stickcplus2`), StickS3 K150 (`sticks3`), standard CoreS3 (`cores3`) and exact CoreS3 SE (`cores3se`). Select based on the controls and features the app needs, or use the exact board you already own. CoreS3 SE has no camera or IMU and must not be mapped to standard CoreS3. StickS3 has its own KEY1/KEY2, microphone and speaker support. Read the device guide before promising a peripheral.

This community preview is tested on macOS Apple Silicon with Chrome. Use the packaged local browser launcher. The embedded Codex panel is outside this release's supported workflow.

## Create and build

Codex copies verified runtime source into a new writable directory using the packaged workspace helper; installed plugin files stay unchanged. It checks prerequisites with `m5stack_doctor`, then prepares dependencies explicitly. Existing approved Node 22+, Python, Git, Clang/Clang++ and platform headers are required.

The generated app files are technical scaffolding. Codex edits `src/user_app.hpp`, `src/user_draw.hpp` and any assets/services into the app you requested. App controls, processing and results belong on the native device screen or its buttons.

<details>
<summary>Equivalent local commands</summary>

From the new workspace, substitute the selected profile:

```sh
./m5preview doctor
./m5preview setup --browser-only
./m5preview web-build --profile <selected-profile>
```

Setup does not install system tools. If execution is denied, stop the affected action; do not bypass it with another interpreter. Missing or dirty dependencies need preservation/recovery guidance, not silent replacement. Setup retains private staging directories; they can consume disk and may share file data through hard links, so do not edit them as independent backups.

</details>

Codex opens the built workspace through the packaged Chrome launcher. **Native app** shows actual C++ framebuffer pixels. The workspace-free **Input preview** is an illustrative control model; it does not compile or run your app. Neither mode runs arbitrary ESP32 firmware or proves physical hardware behavior.

## Edit and test

Use app ID `custom` for your editable app; the legacy `counter` alias uses the same headers. `app-manifest.json` describes the editable source contract. Read [the generic app API](generic-app.md) for touch, swipe, recording metadata, text/image import and draft/request/revision matching. Live microphone input uses the [PCM app interface](microphone-input.md). App-owned speaker samples use the [speaker PCM interface](speaker-output.md). Provider services and app-specific dependencies stay separate from the base plugin.

After an edit, build and reload. Reload starts a fresh worker and clears in-memory app state. Check the changed behavior and the inputs your app uses. Build each profile you claim to support. Inspect unfamiliar C++ before executing it: native code runs with your local process permissions.

<details>
<summary>Build and recovery details</summary>

```sh
./m5preview web-build --profile <selected-profile>
```

Use `m5stack_reload` after the build. Host/bridge edits need a supported restart; preserve unrelated sessions. If the native worker fails, keep the error and last valid frame, fix the cause, rebuild and reload. An illustrative input response does not replace a failed native check.

</details>

Microphone capture requires app demand, a device gesture and browser/OS permission. Verify samples reach the native app while its controls remain responsive; a meter alone does not prove intelligible recording. Capture stops after hiding, replacement, failure or app cancellation, and requires another gesture to resume. Sound is on by default and activates with device interaction. Audio settings provides Mute/Unmute and volume. Unsupported controls are unavailable; AtomS3R has no microphone or audio output, and StickC Plus2 has a buzzer rather than arbitrary PCM playback.

Core POWER click and POWER hold are distinct from touchscreen input. Apps can handle them when the worker advertises `power_button_adapter:1`. Native Reset/RST and Reset app restart the worker through Reload. These emulator controls do not power off hardware, enter its bootloader or open a serial connection. See [the control contract](generic-app.md#core-power-and-reset-controls).

## Keep and share your source

Your app remains in its own workspace through plugin updates. Ask Codex for a source export when you want one. Use the actual profile, an approved interpreter and a new output filename:

```sh
python3 scripts/export_source.py --profile <selected-profile> --app custom --output ./my-app-source.zip
```

The ZIP includes source, documentation, tests, the app manifest and handoff hashes. It excludes dependencies, binaries, logs and sessions. It contains no firmware or recording, and performs no upload. Preserve [notices](../THIRD_PARTY_NOTICES.md) and review sharing rights for any copied code/assets. A screen recording is optional; review it for private content before sharing.

Keep test evidence tied to the exact build and mode. See [current release validation](release-validation.md) for native, browser and hardware status.

## Optional physical installation

When you are happy with the app, ask Codex to install it on a **CoreS3 SE K128-SE, AtomS3R C126 or StickS3 K150**. The [hardware workflow](hardware-workflow.md) handles exact-device checks, pinned setup, declared capability checks, firmware compilation from the same app source, verified private backup, installation and boot diagnostics. Identification alone does not open a port or reset the device. CoreS3 standard and StickC Plus2 remain emulator-only; the [hardware plan](hardware-plan.md) tracks those gaps.

## Keep the shared emulator

Codex prepares assets, edits app source, builds and opens/reloads the chosen workspace. Runtime shows the loaded app; it is not an app launcher. App controls and results stay on the native screen. Changing the shell/runtime requires an explicit request for an emulator change. Community project research is available for inspiration or reusable source, with source/license checks and attribution; it does not replace your own idea. Read [the authoring contract](emulator-contract.md).
