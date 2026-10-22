# Supported scope

Community candidate: **0.7.42**. Hardware acceptance below was collected before this packaging update; no new hardware tests are implied. Browser microphone capture is the supported route. macOS Apple Silicon and Chrome are the tested host combination.

| Capability | AtomS3R C126 | StickC Plus2 | StickS3 K150 | CoreS3 | CoreS3 SE |
|---|---|---|---|---|---|
| Native framebuffer | Yes, 128×128 | Yes, 135×240 | Yes, 135×240 | Yes, 320×240 | Yes, 320×240 |
| Primary input | Display-cap button | A | KEY1 | Touch | Touch |
| Additional app input | Semantic motion | B, semantic motion | KEY2, semantic motion | Semantic POWER/motion | Lower touch strip opt-in, semantic POWER |
| Browser microphone PCM | No hardware mic | Yes | Yes | Yes | Yes |
| Arbitrary speaker PCM | No hardware speaker | No; buzzer only | Yes | Yes | Yes |
| Named HTTP(S) services | Yes | Yes | Yes | Yes | Yes |
| Physical firmware target | Tested | Not implemented | Tested | Not implemented | Tested |
| Physical audio record/playback | Not applicable | Not tested | Passed; too quiet | Not tested | Passed |
| Physical backup/restore/restart | Passed | Not tested | Passed, including battery restart | Not tested | Passed; USB power required |
| Physical Wi-Fi/API | Prior acceptance passed; latest reprovision regression pending | Not tested | GET/POST, reprovision and battery restart passed | Not tested | GET/POST, reprovision and USB restart passed |

“Yes” means the implemented simulator interface, not complete chip emulation. Motion is semantic tilt/shake, not raw calibrated IMU data. StickS3's system reset/power/download button isn't an application key. CoreS3 SE has no camera/IMU or included battery.

## Bounds that matter

- Microphone: raw 16 kHz mono PCM16 to the app. Dual physical microphones are not a stereo capture promise. No built-in transcription or provider integration.
- Speaker: mono PCM16, 8–48 kHz, one clip at a time, up to 30 seconds. Apps prepare/decode samples. Plus2 uses bounded buzzer tones.
- CoreS3 SE/StickS3 firmware audio uses exclusive microphone/speaker I/O, not full duplex.
- Networking: up to four named services; GET and JSON POST, 1 KiB request and 8 KiB response bounds. Verified TLS configuration. No audio upload, multipart or streaming adapter.
- No BLE, camera, storage/SD, GPIO/IR, raw radio, complete RTC or electrical power/battery simulation.
- CoreS3 and StickC Plus2 are emulator-only in this release. Do not flash another board's target onto them.
- Codex panel microphone capture was blocked in inspected host versions. Browser success doesn't establish panel support.
- First-time installation on a separate Mac remains an external acceptance check. Windows/Linux and long-duration operation remain unvalidated.

## Evidence

Previous browser tests delivered live microphone input on all four microphone profiles. Known PCM fixtures were also checked inside native apps, separately from browser meters. CoreS3 SE and StickS3 physical voice playback, app controls and recovery were confirmed manually. Atom display/button/motion and earlier Wi-Fi/API behavior were confirmed physically.

For 0.7.38, the cleaned Hello World compiled for all five profiles, and real worker tests checked supported inputs, app-owned click intents, known microphone PCM and Atom audio rejection. The October 21 browser walkthrough observed CoreS3 SE sample delivery but found a sustained-capture overrun. The user subsequently confirmed the corrected CoreS3 SE MIC bar, counter and audible click. Version 0.7.41 subsequently delivered 70.9 seconds of real Chrome capture with responsive touch. Manual hide, live permission revocation and OS interruption remain incomplete. Version 0.7.42 changes launcher/setup guidance, not device fidelity. The [release checklist](RELEASE-CHECKLIST.md) separates completed checks from pending acceptance. The changed starter has not been tested on physical hardware; the firmware adapters are carried forward.
