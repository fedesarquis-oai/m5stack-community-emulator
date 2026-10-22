# Develop once, run on the device

The user asks Codex to build an app, tests its screen and controls in the fixed emulator, then asks Codex to install it on the connected device. Codex owns the commands below. The user supplies the device and helps with physical observations such as sound quality. Firmware uses the same `src/user_app.hpp`, `src/user_draw.hpp` and assets; the plugin owns the board adapter.

## Current scope

Physical targets are **CoreS3 SE K128-SE**, **AtomS3R C126**, and the new **StickS3 K150** adapter. All three have scoped physical acceptance, including original-firmware restoration and restart. CoreS3 standard and StickC Plus2 still require physical adapters and acceptance. Select the exact profile on build, backup, install, restore and monitor; never reuse another board's receipt. Automatic firmware setup currently supports macOS; Apple Silicon is the first tested host. Requires Python 3, Git, Clang and Make. The pinned Arduino compiler and M5Stack drivers are downloaded locally on first setup. Arduino CLI 1.5.1, Arduino-ESP32 3.3.12, M5Unified 0.2.26 and M5GFX 0.2.33. The SE target explicitly uses 16 MB flash and **8 MB Quad/QSPI PSRAM** (`PSRAM=enabled`); it rejects startup when the expected RAM is missing. On Apple Silicon the plugin builds Arduino's pinned ctags helper natively, including a reserved-macro compatibility fix for modern Apple SDKs.

CoreS3 SE firmware app requirements: `display`, `touch`, `buttons`, `microphone`, `speaker`, `tone`. Codex inspects the app and declares them in workspace `firmware.json`, for example:

```json
{"version":1,"requires":["display","touch","microphone","speaker"],"audioDuplex":"exclusive","speakerVolume":96}
```

Update this declaration when app features change; do not remove a requirement merely to make a build pass. Unsupported requirements (provider-specific services, storage, camera, GPIO etc.) stop the build and require a matching adapter first. This is the plugin's portable C++ app API; arbitrary Arduino sketches do not automatically run in the emulator. Reusable app code belongs in headers under `src/`; desktop runtime `.cpp` files are excluded from the Arduino sketch.

AtomS3R uses 8 MB flash, **8 MB Octal PSRAM** (`PSRAM=opi`), a 128×128 display and the display-cap A button. M5GFX detects the GC9107/ST7735 panel revision. Its firmware requirements are `display`, `buttons`, semantic `motion` (shake/tilt), and optional `network` (Wi-Fi/HTTP(S)). See [network setup](network.md) for private USB provisioning and the matching emulator contract. Example:

```json
{"version":1,"requires":["display","buttons","motion"],"audioDuplex":"none"}
```

Select `--profile atoms3r` on the CLI or `profile: "atoms3r"` on `m5stack_hardware`. The default remains `cores3se` for older calls. A completed short button press delivers `PrimaryClick`; a completed press of at least one second delivers `HoldReset`. Physical reset is the separate system button. BMI270 acceleration passes through M5Unified's board axis mapping, the shared shake detector, and a filtered sideways-tilt adapter bounded to −60…60 degrees. Raw IMU/magnetometer APIs, IR and expansion peripherals are not implemented. The plain controller has no audio or touch input; Atomic Voice Base is a separate configuration. No fake microphone/speaker controls are added.

StickS3 uses 8 MB flash, 8 MB Octal PSRAM, a 135×240 portrait display, BMI270 motion, KEY1 (G11/M5.BtnA) and KEY2 (G12/M5.BtnB). The app must opt into secondary events with `secondary_button_adapter=1`. Completed presses shorter than one second deliver click; longer presses deliver primary HoldReset or SecondaryHold. Both buttons track time independently. `BUTTON2 <milliseconds>` is an explicitly automated diagnostic, separate from physical counts. The separate system button retains power/reset/download behavior.

StickS3's ES8311 microphone and speaker share clock pins. The first adapter deliberately switches between capture and playback. Its sample app uses speakerVolume 128 (50%); M5Stack recommends staying below 75% on battery to avoid power-related restarts. This is not a calibrated volume scale.

For existing StickS3 UiFlow2 firmware, USB may report `StickS3(UiFlow2)` with PID 0x832b and a non-MAC serial. If automatic loader entry disconnects the port, keep USB connected and hold the side reset button until the green LED flashes, then release it. Re-run `devices` and select the ROM loader's exact port and MAC-format serial. Backup/build/install/restore still require the selected profile, matching chip and flash size, and a verified full backup. No full erase is needed. See [the official download-mode instructions](https://docs.m5stack.com/en/core/StickS3).

Firmware settings live beside emulator capabilities in `data/device-profiles.json`; the selected profile and registry are included in build fingerprints. The runner verifies the detected M5 board and PSRAM before starting the app.

`speakerVolume` sets physical driver volume from 0 to 255 (default 64). It is a firmware setting, separate from the browser host volume. Codex can change it for the selected app and rebuild.

Microphone input is 16 kHz mono PCM through the existing callback, with source `device`. Browser and fixture sources retain their own identities. Physical capture follows the app request, with a five-minute session bound. USB diagnostics contain counters and RMS, never raw microphone audio or app secrets.

**Audio concurrency:** the pinned CoreS3 SE drivers share I2S port 1 and clock pins. This adapter uses exclusive audio: playback pauses the microphone, then resumes it if the app still requests input. Touch remains active throughout. Do not claim simultaneous physical recording/playback or acoustic fidelity. A full-duplex requirement is rejected before build. The browser presently permits simultaneous input/output; this difference must be disclosed in readiness checks.

## Codex workflow

Use the model-only `m5stack_hardware` tool with the selected workspace. The same commands are available as `./m5preview hardware <action>` for diagnostics. None are exposed to app/browser code.

Long operations return `status: running` and an `operationId` after about 20 seconds. Continue with `action: status`, the same workspace and operationId. Status returns immediately and never restarts the process; poll at sensible intervals (about 20–30 seconds). Backup progress distinguishes reading from verification; 100% read is not backup completion. Wait for the final verified receipt before install, or confirmed boot after install. Do not disconnect USB while running. Concurrent operations on the same workspace or USB serial are rejected. IDs/results are held in the current MCP process (up to 64, completed results may expire after an hour); they do not survive a service restart. An unknown ID is not proof of failure: inspect private receipts/logs and the actual device before retrying. A v0.7.35 SE backup exposed a five-minute host wait limit while the read continued; the tracked workflow prevents repeating that operation. The CLI remains a synchronous alternative when Codex tracks its process session.

1. `devices`: enumerate USB identities without opening/resetting them. Confirm SKU from the user; USB chip identity alone does not distinguish CoreS3 from SE.
2. `setup`: prepare the pinned local toolchain. Errors name the local log and recovery action; never hide failed setup behind repeated installs.
3. `build`: check `firmware.json`, snapshot the current source into a revision-specific build directory, compile with two workers, produce firmware and a receipt with source/artifact hashes.
4. `backup --port <port> --serial <USB serial>`: verify chip/flash/security state, read the complete flash to a private workspace directory, verify it against the device, save a receipt. It may contain the owner's app/settings; never package, upload or publish it.
5. `install --port <port> --serial <USB serial> --build-receipt <path> --backup-receipt <path>`: require current source and unmodified artifacts, exact connected USB identity and a matching verified backup. Write only the bootloader, partition table, OTA boot selection and app, verify them while the loader still holds the CPU, then boot and check the build ID. No full-chip erase or eFuse change. User authorization to deploy/test the selected device is required; do not re-ask when already provided.
6. `monitor --port <port> --serial <USB serial> --seconds 5`: report bounded structured status. `--command 'TAP 30 100 50'` (CoreS3 SE), `--command 'BUTTON 50'` (AtomS3R), and `RESET_APP` exercise the app through explicitly labeled automated inputs. They do not count as physical touch evidence.
7. `network-prepare --profile <profile>` creates a private editable credential template. `network-configure --profile <profile> --port <port> --serial <USB serial>` provisions the matching running CoreS3 SE, AtomS3R or StickS3 without returning secrets. `network-forget` clears plugin-managed device network settings when requested. See [network setup](network.md) for pause/retry behavior and limits.

Optional `network` is available in all three firmware targets. SE and Stick passed scoped public HTTPS GET/POST, saved-settings cold restart and forget/reprovision acceptance on October 20; Atom retains prior network acceptance, with the new forget operation awaiting regression. A configured board can call public HTTPS services without a local Mac server.
8. `restore --port <port> --serial <USB serial> --backup-receipt <path>` restores and verifies the original whole-flash image before booting it when the user requests recovery. Confirm the original app starts separately.

Build receipts are invalid after any source/adapter/build-recipe change. Keep failed build directories for diagnosis. Stop on identity/security mismatch, failed backup, missing capability, stale artifact, or unconfirmed boot. Do not guess another port or flash a different profile. If serial access is denied by the execution environment, request that permission through its supported mechanism.

Fixed sound assets should be prepared by Codex before compilation. Do not run expensive synthesis/decoding in a physical input handler; the desktop can conceal seconds of embedded CPU latency. Runtime diagnostics report handler and speaker-start times in microseconds.

If the USB port exists but both diagnostics and the loader stop answering, reconnect the data cable and re-identify the same board. Never treat an empty diagnostic response as success or automatically erase firmware. A successful write/digest verification can still return `written_and_verified_boot_unconfirmed`: briefly press the physical reset button (do not hold it), re-enumerate USB and monitor the exact build. StickS3 required that physical reset after the first upload from manual download mode. Do not reflash merely because the automatic reset produced no status.

## Acceptance

Check matching source/build identity in the emulator and firmware, boot without the computer's backend, display geometry and fonts, actual touch and hold, lower touch strip, PCM playback/stop/replacement, microphone start/stop/sample order, and touch while audio is active. Measure physical memory limits. Repeat once after an app edit to verify the real development loop. Record automated, device-reported and user-observed evidence separately. A verified flash write alone is not a successful app test.

Application-specific services such as transcription remain outside the plugin. A hardware app needing one must declare that requirement and receive a real device/backend connection adapter; a localhost browser service is not a physical network implementation.

Physical input diagnostics retain separate counters for taps, holds, swipes, lower-strip touches and power-button events. Automated taps never increment those counters. Short-press timing is tracked independently of the M5Unified release timestamp.

AtomS3R diagnostics report physical button clicks/holds, shake/tilt events, bounded acceleration and IMU sample/invalid-sample counters. These are separate from automated button commands.

For audio testing, measure the app's PCM peaks as well as the physical volume setting. Quiet prepared assets remain quiet at a high volume setting. Normalize fixed assets offline when the app needs stronger output; any voice-playback gain belongs in app processing. The generic microphone and speaker contracts must not silently normalize or amplify arbitrary applications. StickS3 battery guidance recommends speaker volume below 75%; its pinned board driver has its own gain calibration, so do not equate an identical numerical setting with another board's acoustic loudness.
