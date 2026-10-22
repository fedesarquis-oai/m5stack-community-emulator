# Candidate validation — 0.7.42

Updated October 22, 2026 on macOS Apple Silicon. This release improves GitHub onboarding and runtime selection; device adapters, app APIs and physical acceptance are unchanged.

- **PASS:** 40 server, exact-profile, browser-transport and launcher tests, including 19 launcher cases. Both MCP and browser modes select one approved Node runtime, preserve quoted paths and stop on selected-runtime failure.
- **PASS:** The real `sh server/launch.sh --browser` command started with PATH limited to /usr/bin:/bin and used the available desktop-bundled runtime. It printed a local URL and shut down cleanly with no stderr. This is a launcher check; it did not capture a microphone or repeat browser UI acceptance.
- **Scoped coverage:** Codex.app runtime candidates were exercised through isolated executable-path fixtures. This Mac has ChatGPT-hosted bundles, so a fresh Codex.app-only installation is still unverified.
- **Prepared, not published:** GitHub-first instructions let recipients paste the actual repository URL into Codex. A real public URL, published clone and GitHub Actions result still require publication. Local packaging or cloning is not proof of a GitHub installation.
- **Unchanged remaining gates:** Another-Mac onboarding and the manual Chrome hide, live permission-revocation and OS audio-interruption checks from 0.7.41 remain pending. No USB access or physical-device writes were performed.

# Earlier validation — 0.7.41

Updated October 21, 2026 on macOS Apple Silicon. This community preview starts with the user's own app idea and runs the native app in Chrome. Physical installation is optional. Earlier evidence below remains scoped to its original version.

## Current fixes and automated checks

| Check | Result | Evidence and limits |
|---|---|---|
| Microphone demand and recovery | **PASS** | 181 focused UI, worklet, controller and native-audio checks. Covers stale frames after recording ends, a new request before a false frame is observed, reordered acknowledgments, malformed cleanup replies, denial, hide/Stop, track/context interruption and retry. Includes 299.9 seconds of ordered synthetic PCM and the five-minute cutoff; synthetic timing is not a real five-minute capture. |
| Hardware setup Git environment | **PASS** | 9 new setup regressions, 14 existing workflow tests and 6 hardware-job tests. The same host Git reproduced the missing HTTPS helper with relocation variables absent. The fix then cloned and compiled the official pinned ctags dependency in 14.85 seconds. This exercises the failed setup stage; it is not a full fresh firmware toolchain install. |
| Server, transport and launcher | **PASS** | 24 tests passed after rebuilding the final server and UI. Exact profiles, tool metadata, browser isolation, reload, shutdown and unsupported Node handling included. |
| Fresh native app setup | **PASS** | A separate empty workspace downloaded and verified both pinned libraries and built CoreS3 SE with two compiler workers. Build 27e633f691f707c0. |
| Onboarding | **PASS** | Repository instructions, installed skill, default prompt and tool descriptions ask what the user wants to build first. No showcased app or required community-search detour. |
| Real Chrome capture | **PASS, bounded scope** | Final 0.7.41 UI delivered 1,134,400 accepted samples (70.9 seconds at 16 kHz) and 1,128,000 app-processed samples in the observed poll while touch remained responsive. Sample counts increased without an overrun. Earlier in this pass, permission denial produced LIVE_PERMISSION, restoring permission alone did not restart capture, and a fresh gesture recovered. |
| Real Chrome hide/revocation and OS interruption | **INCOMPLETE** | The attempted tab-hide check did not establish visibility-triggered shutdown under browser automation; later native UI actions were interrupted by user activity. Permission revocation during capture and OS-level interruption were not verified. These cases have automated coverage but still need a manual pass. Test servers and owned tabs were closed. |
| Clean extraction | **PASS** | Two fresh packaged launcher processes reported server/catalog 0.7.41, 14 tools and all five profile guides, with empty stderr and clean shutdown. A verified workspace was created, and repeat creation refused to overwrite an edited workspace; all 67 files stayed unchanged. This is not a new host installation. |

The current release changes the host workflow and documentation. It does not change the firmware adapter or the user's app source. A separate CoreS3 SE app was built from the same source for Chrome and hardware during the preceding 0.7.40 session; its verified backup, installation, boot and ten-second record/playback were accepted by the user. That physical success is historical evidence, not a new 0.7.41 flash test. No USB access was needed for this release pass.

New installation on another Mac remains **not run**. The default installed plugin and all separate app workspaces remain preserved. See [the release checklist](RELEASE-CHECKLIST.md) for remaining scope and [sharing instructions](SHARING.md) for the community ZIP.

# Earlier validation — 0.7.40

Updated October 21, 2026 on macOS Apple Silicon. Earlier 0.7.38 checks below remain scoped to that artifact; the 0.7.39 and 0.7.40 browser passes are recorded separately. This is not a claim of full hardware emulation.

| Check | Result | Evidence and limits |
|---|---|---|
| Tools, browser transport, launcher and audio lifecycle regressions | **PASS** | 208 tests passed, zero failed/skipped. Includes denied/late microphone grants, track end, hide/stop, bounded PCM, empty/repeated output packets, context interruption, stale sessions, expiry and no automatic action replay. Browser/OS APIs are controlled test doubles here. |
| Dependency setup recovery | **PASS** | 13 offline tests with real local Git objects: fetch failure/retry, repeated setup, dirty/incomplete paths preserved, concurrent publication, symlinks, timeout and interrupt cleanup. No download or USB in this suite. |
| Native build recovery | **PASS** | Two real compiler/local Git checks: partial compiler output does not poison retry, last valid receipt remains usable, inherited Git routing cannot redirect source enumeration. |
| All five native builds | **PASS** | Fresh workspace, no reused build outputs. The two previously fetched pinned dependency checkouts were copied and reverified; setup did not need to download them again. |
| Native microphone and controls | **PASS** | All five real workers passed primary/hold and supported secondary/click behavior. Four mic profiles received 1,600 known PCM frames at expected 0.25 RMS while controls remained responsive, then stopped. Atom rejected microphone input. This does not record or listen to a microphone. |
| Chrome non-audio interaction | **PASS** | Atom native display, button counter, semantic tilt/shake, reload to initial state, Runtime version 0.7.38, and stop/disabled inputs observed. The test tab and local server were closed. [Captured screen](assets/atom-preview.png). No media permission was requested. |
| Bundle reproducibility | **PASS** | All five bundles, build metadata and dependency notice inventory were byte-identical when rebuilt from the plugin directory and a different working directory. |
| Package/extraction | **PASS** | Reviewed file hashes and source boundaries, clean extraction, actual MCP launcher startup, 14 tools/five exact profiles, verified workspace creation and byte-identical ZIP reproduction. This is not a live installation into another Codex account. |
| Current live Chrome microphone/speaker/revocation | **PARTIAL — follow-up required** | Initial app delivery and permission-timeout recovery observed on 0.7.38; a sustained-capture overrun led to the 0.7.39 correction below. User subsequently confirmed the corrected CoreS3 SE microphone bar, counter and audible click. Exact sustained duration and real permission-revocation acceptance remain pending. |
| New installation on another Mac | **NOT RUN** | Requires an independent tester following INSTALL.md. |
| Current installed Codex panel microphone | **NOT RUN** | Historical host media rejection is documented; no new desktop-panel support claim. |
| Physical devices for this candidate | **NOT RUN — paused** | Existing scoped acceptance is retained in SUPPORT-MATRIX.md. No USB access or writes performed for this release pass. |

Four issues found during this release pass were reproduced and fixed: partial compiled-object reuse after failure; inherited Git routing during native source enumeration; queued speaker output left enabled after final-packet context interruption; and working-directory-dependent bundle output. No failure remains open in the listed automated checks. Node versions below 22 now receive a clear launcher error and are never silently substituted after execution failure.

This package is a **community preview**. It is prepared locally, not installed into the author's existing plugin, publicly published or submitted to an official directory. The honest remaining gates are in [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md).

## Browser-first walkthrough — October 21

- Supported CLI install, repeat install, removal and 0.7.37 → 0.7.38 upgrade passed in an isolated Codex home. The actual installed manifest launcher exposed 14 tools and five profiles. Default plugin configuration/cache stayed unchanged. A separately created workspace survived uninstall. This used the current Mac and installed Codex CLI; another-machine onboarding is still pending.
- A fresh native setup fetched both pinned dependencies into an empty workspace; the Atom build and actual worker button check passed.
- A separate app workspace was created from the verified 0.7.38 archive. Changing only app headers changed the native title and counter step to +5; all five profiles built. Chrome showed the new app through the fixed shell. Atom button/hold/tilt/shake and CoreS3 SE touch worked.
- Actual CoreS3 SE Chrome capture delivered over 600,000 samples to the app while touch remained responsive, then stopped with LIVE_OVERRUN. Permission-timeout recovery succeeded after foregrounding the tab and another gesture. This is a partial capture result, not a sustained-audio pass.
- Two issues are fixed in 0.7.39: refresh during an in-progress worker replacement returned an old session; the 300 ms microphone backlog budget was too short for a brief stall. Bootstrap now waits for replacement; PCM buffering is bounded to one second and dispatches immediately. Focused regressions verify ordered, exact PCM after a 600 ms stall, explicit overrun beyond the bound, cleanup and current-session bootstrap.
- The disconnected-server UI was observed to explain that Codex must rerun the launcher and provide a new URL.
- After reopening the corrected preview, the user confirmed all three: microphone bar response, +5 counter and audible clicks. The exact sustained test duration was not reported; permission-revocation acceptance remains pending. No new physical, panel or independent-machine acceptance is claimed.

## Sound default — 0.7.40

User feedback: the separate Enable sound action was confusing. Output now starts from the first device gesture on all four speaker/buzzer profiles; opening alone remains silent. Mute is an explicit preference separate from lifecycle shutdown and persists across reload/profile/hide within the page. Atom still has no audio output. The actual UI-module checks verify these transitions and app tone playback, alongside existing speaker scheduling/release coverage. Microphone code is unchanged from 0.7.39. All 190 relevant UI-module, device-media and speaker-PCM tests passed. In actual Chrome, the first CoreS3 SE touch changed output from Ready to On without using an audio control, incremented the native counter and started app-requested capture. Mute remained effective through another device input; Unmute restored On. This check observes output state; the earlier audible click was confirmed by the user.

## Repeat relevant checks

From the plugin directory:

```sh
node --test tests/application-server.test.mjs tests/device-profiles.test.mjs tests/browser-preview.test.mjs tests/launcher.test.mjs ui/tests/speaker-pcm.test.mjs ui/tests/device-media.test.mjs ui/tests/live-microphone.test.mjs ui/tests/live-microphone-processor.test.mjs ui/tests/preview-connection.test.mjs
python3 -B runtime/tests/build_recovery_test.py
python3 -B runtime/tests/setup_recovery_test.py
```

From the repository root, after following the build instructions:

```sh
python3 scripts/package.py
node scripts/smoke.mjs
node scripts/smoke.mjs --workspace /absolute/unmodified-built-starter
```

The last command requires all five profiles already built and runs trusted native app code. Do not rerun broad checks merely to increase a test count; choose checks for changed behavior or unresolved failures.
