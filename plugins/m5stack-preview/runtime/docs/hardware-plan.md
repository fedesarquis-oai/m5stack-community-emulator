# Hardware coverage and remaining work

The supported path is one portable app workspace → native emulator → exact-board firmware build → verified backup/install → physical acceptance. A desktop executable cannot be flashed onto an ESP32. Use [hardware workflow](hardware-workflow.md) for the actual commands, prerequisites and recovery procedures.

## Current targets

| Board | Physical implementation | Physical acceptance | Still outstanding |
|---|---|---|---|
| AtomS3R C126 | Display-cap button, 128×128 display, semantic tilt/shake, optional Wi-Fi/HTTP(S) | Display/input/motion, original-firmware restore, USB/RST restart, earlier API and persisted-network checks | Latest forget/reprovision regression; raw sensors, IR, GPIO |
| StickS3 K150 | KEY1/KEY2, 135×240 display, semantic motion, exclusive microphone/speaker, optional Wi-Fi/HTTP(S) | Both keys/holds, audio/voice playback, restore, battery restart, public GET/POST and forget/reprovision | Final listening check after app loudness adjustment; other peripherals |
| CoreS3 SE K128-SE | Touch and opted-in lower strip, semantic POWER, 320×240 display, exclusive microphone/speaker, optional Wi-Fi/HTTP(S) | Tested touch/hold/swipe/strip/POWER events, voice playback, restore, USB/RST restart, public GET/POST and forget/reprovision | Exhaustive touch boundaries/power states and other peripherals |
| StickC Plus2 K016-P2 | No firmware target in this package | None | Exact board adapter and full acceptance; retain its buzzer rather than inventing speaker PCM |
| CoreS3 K128 | No firmware target in this package | None | Exact board adapter and full acceptance; do not flash the SE target |

Acceptance is scoped, not a claim of every physical feature. See [release validation](release-validation.md) for dates and evidence. The v0.7.38 starter cleanup has not been tested on hardware; the firmware adapters are carried forward. Hardware testing is optional for simulator-only users.

## Repeatable deployment sequence

1. Confirm exact SKU, accessories, USB identity, power source and the app the user wants installed. Do not infer the model from a similar USB label.
2. Check the app's declared features against that target. Explain unsupported peripherals/services before building; browser success alone is insufficient.
3. Use the pinned toolchain and exact memory/PSRAM settings. Build firmware from the same app model, drawing and assets used in simulation, retaining source/build receipts.
4. Preserve a verified private full-flash backup before replacing existing firmware. Match backup and install receipts to the exact board. Keep backups out of public archives.
5. Install only the authorized artifact. Distinguish verified flash from successful startup; inspect boot diagnostics and ask for a brief physical reset when required.
6. Test display orientation, all app inputs, relevant audio/network behavior, interruption/cancellation and restart. Ask the user to listen or observe only where automated evidence cannot establish the result.
7. Keep the final app on the device or restore the prior firmware as requested. Report what passed and what remains unverified.

For a new target, implement each step before calling it supported. Do not repeat successful hardware acceptance solely for a documentation/package revision.

## Peripheral boundaries

| Peripheral | Current shared API | Future work |
|---|---|---|
| Display/input | Native framebuffer; supported completed touch/button gestures | Exact missing-board drivers and exhaustive coordinate/debounce checks |
| Microphone | 16 kHz mono PCM16 callbacks on four simulator profiles; physical SE/Stick capture | Calibrated levels, dual-channel policy, long-duration stress |
| Speaker | App-owned mono PCM16, 8–48 kHz, one clip up to 30 seconds | Calibrated physical loudness, indefinite streaming and full duplex |
| Buzzer | StickC Plus2 tone intents | Its physical target and frequency/duration checks |
| Motion | Semantic tilt/shake where present | Raw IMU axes, calibrated sample timing and other sensors |
| Power | Limited Core POWER semantics and simulator reset | Sleep/wake, charging, brownout and complete PMIC behavior |
| Wi-Fi/API | All five simulator profiles; three firmware targets; bounded GET/JSON POST | Atom reprovision regression, other routers and long-duration recovery; audio upload/streaming is outside this API |
| BLE, camera, SD/storage, RTC, GPIO/IR/Grove buses | Not implemented | Explicit app contracts, per-board adapters, fixtures and physical acceptance |

For every extension, define capability/error behavior, implement the simulator and board adapters, then compare the same app on both. A synthetic fixture is not physical hardware. Keep app-specific test programs outside the base plugin.

## Findings to preserve

- CoreS3 SE uses 16 MB flash with Quad/QSPI PSRAM. AtomS3R and StickS3 use 8 MB flash with Octal PSRAM. Do not substitute a neighboring board's settings.
- SE and Stick physical audio use exclusive capture/playback. Simultaneous browser I/O does not prove firmware full duplex. Computer audio does not model codec noise or enclosure acoustics.
- Prepare fixed sound assets at build time. Earlier runtime synthesis caused seconds of tap latency; prepared assets reduced the measured input/startup code path to about 20 ms. This is not an acoustic latency guarantee.
- Browser volume and firmware `speakerVolume` are separate. The unresolved Stick loudness report concerns the physical test app. Do not amplify microphone input merely to make its UI meter appear larger.
- StickS3 UiFlow and the ROM loader can use different USB identities. Re-enumerate after entering download mode; never weaken exact-target checks. Its system reset/power button is distinct from KEY1/KEY2.
- Long USB operations return an operation ID. Poll it rather than starting a second backup/flash. After an unknown outcome or service restart, inspect receipts and device state first.
- Full original-flash restoration passed on all three tested targets. Interrupted-flash recovery, every power state and indefinite memory stability remain unverified.
- Configured public-API firmware runs without a Mac server, provided the board has power and Wi-Fi. CoreS3 SE has no included battery. A localhost application service still needs its host computer.

## Sources

Exact board guidance: [AtomS3R](https://docs.m5stack.com/en/core/AtomS3R), [StickC Plus2](https://docs.m5stack.com/en/core/StickC-Plus2), [StickS3](https://docs.m5stack.com/en/core/StickS3), [CoreS3](https://docs.m5stack.com/en/core/CoreS3), [CoreS3 SE](https://docs.m5stack.com/en/core/CoreS3-SE).

Drivers: [M5Unified](https://github.com/m5stack/M5Unified) and [M5GFX](https://github.com/m5stack/M5GFX). Runtime/toolchain revisions remain pinned in the package. Community project discovery uses [M5Burner](https://burner.m5stack.com/); inspect and credit each original project's source and license before reuse.
