# Validation record

These records distinguish current source/native checks from earlier browser and physical observations. A passed simulation does not establish physical fidelity or a fresh host permission result.

## Community candidate 0.7.42 — October 22, 2026

GitHub-first guidance lets people ask Codex to install from a real repository URL, with no manual clone. MCP and Chrome now use one shell launcher for Node selection. Forty server/profile/browser/launcher tests passed, including nineteen launcher checks. The actual browser launcher started and shut down cleanly with no Node on PATH, using this Mac’s desktop-bundled runtime. Codex.app path candidates have fixture coverage only; no fresh Codex.app-only or another-Mac installation is claimed. Device behavior and prior audio/hardware evidence are unchanged. Public GitHub clone and CI verification remain pending until publication.

## Community candidate 0.7.41 — October 21, 2026

- Onboarding asks what the user wants to build, then selects the supported profile and creates their separate app workspace. Community discovery and physical hardware are optional.
- Hardware setup now recovers missing Git helper defaults from the selected Git distribution while preserving explicit settings. Nine setup, fourteen workflow and six hardware-job tests passed. The actual pinned ctags clone and compilation also passed with the relocation variables removed; the entire firmware toolchain was not downloaded again.
- Microphone demand uses ordered acknowledgment/frame revisions to reject stale requests after capture ends while allowing a fresh request even if the intervening false frame was not shown. All 181 relevant UI/worklet/controller/native-audio tests passed, including denial/recovery and synthetic five-minute lifecycle coverage. Twenty-four server/browser/launcher regressions also passed.
- A fresh separate CoreS3 SE workspace downloaded both pinned native libraries and compiled. The repository validation record contains the current real Chrome and package-extraction results.
- The final Chrome UI reported 0.7.41 and delivered 70.9 seconds of real microphone samples while touch remained responsive. Denial and explicit retry passed earlier in the release pass. Manual tab-hide, live permission revocation and OS interruption remain incomplete; automated lifecycle coverage is not a substitute for those checks.
- A separate app from the preceding 0.7.40 run passed verified backup, install, boot, touch and ten-second voice playback on physical CoreS3 SE, with explicit user acceptance. This is historical app acceptance, not a new hardware pass for 0.7.41. No USB access or writes were performed for this candidate.

## Browser candidate 0.7.40 — October 21, 2026

- User confirmed the reopened 0.7.39 CoreS3 SE test's MIC bar, counter and audible click. Exact sustained duration and permission revocation were not reported.
- Output now defaults on and activates from device gestures on all speaker/buzzer profiles. Explicit mute is preserved within the view across reload/profile/hide; Atom does not create output audio. All 190 relevant UI-module, device-media and speaker-PCM checks passed. Actual Chrome showed output On after the first CoreS3 SE touch without an audio-button action; native counter and microphone capture continued. Explicit mute survived another touch and Unmute restored output.

## Browser candidate 0.7.39 — October 21, 2026

- Browser-first agent guidance now opens the fixed Chrome shell; the embedded Codex panel is outside this release's acceptance scope.
- Real 0.7.38 Chrome CoreS3 SE capture delivered over 600,000 samples while touch worked, then stopped with LIVE_OVERRUN. The permission-timeout retry path worked. This is partial evidence, not a long-duration pass.
- Fixed bootstrap returning an old session when Chrome refresh overlapped worker reload. Added an exact delayed-reload regression.
- Expanded bounded PCM buffering from three to ten 100 ms chunks. Dispatch remains immediate. A 600 ms delayed acknowledgment test checks every sample and contiguous sequence; overrun and cleanup remain explicit.
- The user subsequently confirmed microphone response, counter and audible click on the corrected build. Exact sustained duration and permission revocation remain pending. No new physical acceptance is claimed.

## Community candidate 0.7.38 — October 20, 2026

- The cleaned runtime contains one editable Hello World model/drawing. Both `counter` and `custom` select that starter; removed demo IDs are rejected.
- Fresh native dependency setup fetched the two pinned LVGL/M5GFX sources. Hello World compiled for all five profiles on macOS Apple Silicon.
- Real native integration checked primary/hold actions, supported secondary controls, app-owned click intents, 1,600 known PCM samples with 0.25 RMS on every microphone profile, controls during input, stop, and Atom's no-audio policy.
- The final release pass passed 208 server/UI/launcher/audio lifecycle tests, 13 dependency setup recovery tests and two real-compiler build recovery tests. Relevant model/drawing checks also passed after updating obsolete tests for the removed demo apps. These checks do not capture a real microphone or listen to sound.
- The built Chrome shell rendered the cleaned starter; the final Atom control-only check passed button, motion, reload, version and stop. The user postponed the new live microphone/listening check. Do not record that manual check as passed.
- No hardware writes or new hardware acceptance were performed for this candidate. The firmware adapters carry forward from 0.7.36; the updated starter's physical behavior remains untested.

Community repository packaging/extraction and publication gates are tracked in its `docs/RELEASE-CHECKLIST.md`. First-time installation on another Mac remains pending. Codex panel microphone support, Windows/Linux and long-duration operation are not claimed.

## Earlier browser/native acceptance

Real Chrome microphone input was confirmed on all four microphone profiles during development, with native received-sample evidence. The latest pre-cleanup manual check was StickS3 on v0.7.35: its native screen showed 294,400 samples. Controls continued to work during capture. Earlier speaker tests on CoreS3 SE and StickS3 were heard clearly by the user; native checks separately validated sample ordering and capability selection.

The older recording experiment and provider integrations are not included. Earlier inspection found a Codex MCP App host media-permission rejection. This is historical host evidence, not a diagnosis of every future desktop build. Use the same shell in Chrome until panel capture is independently validated.

## Earlier physical acceptance

| Target | Confirmed scope | Limits/follow-up |
|---|---|---|
| CoreS3 SE, October 13 and 20 | Display, tested touch/hold/swipe/lower-strip/POWER events; chime/drums and intelligible three-second voice playback; responsive input and bounded audio lifecycle cycles; verified 16 MB backup/restore and user-confirmed boot; USB power-cycle and RST; public HTTPS GET/JSON POST, forget/reprovision and saved Wi-Fi after restart | Exclusive mono I/O; no included battery; no full-duplex, calibrated audio, exhaustive control-boundary or interrupted-flash claim |
| AtomS3R C126, October 13 | Upright display; primary click/hold; semantic tilt/shake; verified 8 MB backup/restore and normal boot; second app revision from same native/firmware source; USB/RST restart; HTTPS/API cases, responsive cancellation, saved Wi-Fi/NTP after cold start | Latest setup/forget/reprovision regression pending; no onboard audio; raw IMU/IR/GPIO unimplemented |
| StickS3 K150, October 14 and 20 | Upright display; both key clicks/holds; semantic motion; clear sounds and intelligible voice playback; bounded cancellation/stop/replacement cycles; verified 8 MB restore and normal boot; physical reset and battery restart; public HTTPS GET/JSON POST and forget/reprovision | Sound remained too quiet for the user; a later test-app asset gain adjustment still needs listening acceptance. Exclusive I/O; system button is separate from app keys |

The public network checks used [httpbin](https://httpbin.org/), by Kenneth Reitz and contributors, with a fixed nonpersonal marker and verified TLS. CoreS3 SE and StickS3 returned HTTP 200 after real user input and power cycles without a Mac API server. Simulator HTTP uses the computer's network; it is not Wi-Fi radio simulation.

Physical evidence comes from separate test apps and private receipts, not hidden base-plugin features. App sources, recordings, credentials, firmware backups and personal logs from those sessions are excluded from the community distribution. See [hardware coverage and remaining work](hardware-plan.md).
