# Build an app with the existing emulator

Read the [packaged skill](../plugins/m5stack-preview/skills/m5stack-preview/SKILL.md) before using tools. Discover their actual schemas instead of inventing arguments.

| Step | Agent action | Completion evidence |
|---|---|---|
| Understand | Ask what the user wants to build unless they have already described it | App purpose and main interactions come from the user |
| Identify | Recommend or confirm an exact profile from catalog/guide for that idea | Profile ID and supported inputs match the request; hardware remains optional |
| Create | Copy the verified runtime into a new user workspace | Existing user source preserved; no installed-cache edits |
| Prepare | Run doctor and explicit `setup --browser-only` | Required tools and pinned native sources available |
| Author | Edit `src/user_app.hpp`, `src/user_draw.hpp`, assets and app-owned services | All interactions/results render on the native screen or device buttons |
| Build | `m5stack_build` or `./m5preview web-build --profile <id>` | Current native build receipt for the actual profile |
| Open | Packaged local browser launcher in Chrome; keep the embedded Codex panel outside this release | Native app pixels visible; launcher remains alive |
| Test | Real device controls; relevant audio/network lifecycle | Observed results separated from automated/source checks |
| Iterate | Build and reload after edits | New session uses the new app build; no stale result injection |
| Deploy, if requested | Hardware workflow on exact supported board | Verified backup, flash receipt and boot evidence are distinct |

## Read only what the feature needs

- [App interface, controls and result matching](../plugins/m5stack-preview/runtime/docs/generic-app.md)
- [Microphone PCM input](../plugins/m5stack-preview/runtime/docs/microphone-input.md)
- [Speaker PCM output](../plugins/m5stack-preview/runtime/docs/speaker-output.md)
- [Network configuration and HTTP limits](../plugins/m5stack-preview/runtime/docs/network.md)
- [Hardware backup/build/install/recovery](../plugins/m5stack-preview/runtime/docs/hardware-workflow.md)
- [Existing-project discovery and attribution](../plugins/m5stack-preview/skills/m5stack-preview/references/project-discovery.md)

Use `custom` for the user's editable app; the legacy `counter` alias also uses the same app headers. The generated workspace is technical scaffolding. Replace its behavior and rendering with the user's app before presenting the build as complete. Do not make an example app or a community fork the default task. Search existing projects when the user wants inspiration/reuse or a substantial feature would benefit from prior work, while keeping the user's idea in control. A downloaded Arduino sketch or ESP32 binary is not automatically compatible. Explain missing interfaces before proposing an emulator extension.

## Microphone acceptance

Capture is app-requested, not an external recording workflow. Use a fresh device gesture in an active Chrome tab. Verify received samples in the app, responsiveness to touch/buttons during capture, and that stopping/hiding releases the mic. A waveform or a successful permission request alone doesn't prove delivery. When the app uses recorded speech, verify intelligibility with its recording/playback flow and ask the user to listen. If a separate diagnostic is needed, keep it in a disposable workspace and explain its purpose; do not turn it into the user's app. Keep recordings out of the repository. Never invent a transcript as evidence of PCM delivery.

## Networking and physical independence

Simulation calls named services over the computer's network. Firmware uses device Wi-Fi after private USB provisioning. Public API apps can operate without a running Mac once deployed, provided the board has power and network access. A service hosted on localhost still requires that computer. Read the adapter's request/response limits before promising OpenAI or another provider integration. Base networking doesn't include audio upload or streaming.

## Handoff

Return the app workspace, selected profile, build/preview result, controls, tested behavior and material gaps. Keep test apps separate from the plugin. Do not report a browser simulation as physical verification or a verified flash as confirmed boot. Continue the authorized workflow without repeatedly asking permission for routine builds or already-authorized hardware work.
