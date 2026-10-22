# Changelog

## 0.7.42 — GitHub setup and shared browser launcher

- GitHub onboarding now lets people paste the repository URL into Codex and ask it to install the plugin, check prerequisites and build their own app. Manual cloning remains optional.
- Added `sh server/launch.sh --browser` so the Chrome preview uses the same Node selection as the plugin, including executable Codex and ChatGPT bundle candidates when Node is absent from PATH.
- Launcher checks cover both entrypoints, quoted workspace paths, missing/unsupported runtimes and terminal execution failures. No runtime is installed or substituted after a selected executable fails.
- Aligned Python requirements and the support matrix with the current validation record. Device adapters and app source are unchanged.

## 0.7.41 — setup, recording recovery and your own app

- New-user onboarding starts with the app they want to build, followed by an exact device profile, a separate workspace and Chrome testing. Community discovery and physical installation are optional.
- Hardware setup recovers missing Git helper defaults from the same Git installation selected by the host. Explicit Git settings and company configuration stay in effect; unresolved helpers produce a useful error before toolchain downloads.
- Microphone demand follows committed app state and ordered audio acknowledgments, preventing stale frames from reopening capture after a recording ends while allowing a fresh app request to start another recording.
- Expanded regression coverage for denial, interruption, recovery and the five-minute PCM limit. Added sharing instructions for the repository ZIP and its checksum.
- Documented record-to-play sequencing and fixed-width C++ portability for apps compiled on both the Mac and ESP32.

## 0.7.40 — sound on by default

- Speaker and buzzer output now activate from the first device interaction, without a separate Enable sound step. Opening the page alone does not autoplay.
- Mute/Unmute and volume remain in Audio settings. Explicit mute survives app reload, profile changes and hide/show within the current view. Audio resumes after lifecycle shutdown only on a fresh gesture.
- Atom keeps its actual no-speaker capability. Microphone permission and app demand are unchanged.

## 0.7.39 — browser walkthrough fixes

- Browser bootstrap waits for an in-progress reload/device change before returning its session, preventing an old session after refreshing Chrome during reload.
- Live microphone delivery tolerates a bounded one-second backlog (ten 100 ms PCM chunks), instead of 300 ms. Chunks still dispatch immediately; ordering, cleanup and explicit overrun failure remain enforced.
- New-user agent guidance now defaults to the Chrome emulator. Embedded Codex-panel acceptance remains outside this community release.

## 0.7.38 — recovery fixes and final local verification

- Native builds publish compiled objects only after success, so an interrupted compiler cannot poison the next build. The last valid build receipt is preserved.
- Native source enumeration uses the same bounded, workspace-scoped Git helper as dependency setup.
- The plugin launcher reports unsupported Node versions before starting the server; package checks now exercise that actual launcher.
- Speaker interruption now releases queued output immediately, including after the last PCM packet. Empty/repeated completion packets also detect delayed context interruption. Re-enabling requires a new explicit action.
- Made committed bundles and dependency inventory independent of the invoking working directory.
- Reconciled the historical StickS3 microphone evidence to v0.7.35 on October 20. Final real-browser audio/revocation acceptance and independent installation remain postponed; no new hardware or panel microphone acceptance is claimed.

## 0.7.37 — community release candidate

- Reduced the runtime to one editable Hello World starter, removing 8 Ball, mascot/trail demos and alternate SDL/Python viewers. Native setup now fetches only LVGL and M5GFX.
- Added app-owned click feedback and secondary-button color/reset feedback to Hello World, capability gated.
- Added repository-based installation, an agent handoff, contribution instructions, issue forms, a support matrix and data-handling notes.
- Added a locked dependency setup and portable notice/packaging scripts, with committed server/UI bundles for installation without a JavaScript build.
- Fixed exact catalog profile IDs such as `cores3se` failing device-guide lookup. Unknown board names remain unsupported.
- Corrected tool annotations for operations that execute apps and may trigger configured external requests, including frame polling and timers.
- Updated stale setup/hardware documentation. Preserved the existing plugin identity and fixed emulator shell.

Existing browser microphone, app-owned speaker, optional networking and three physical firmware targets carry forward from 0.7.36. This packaging update does not claim new hardware acceptance, Codex panel microphone support or complete peripheral emulation.
