# Agent instructions

This repository distributes the existing `m5stack-preview` plugin. Read the user's request first and choose the workflow below. Never turn an ordinary device-app request into an emulator rewrite.

## Installing this repository

1. Read `docs/INSTALL.md`. Resolve the actual repository root; never use a developer's hardcoded path.
2. Inspect the available Codex CLI's `plugin marketplace add --help` and existing marketplace/plugin configuration through supported tools. When the user supplied this repository's real GitHub URL, register that Git source directly with `codex plugin marketplace add <repository-url>`; a manual clone is unnecessary. For an already selected local checkout, register its root using `codex plugin marketplace add <absolute-repository-root>`. If the CLI is unavailable, use the host's supported Plugin Creator/local marketplace flow. Don't edit installed cache files or overwrite other marketplace entries.
3. Install with the supported `codex plugin add m5stack-preview@m5stack-community` command, or help the user select **M5Stack Community Emulator** from **M5Stack Community** in the plugin directory. Restart/reload only when necessary. If an older `m5stack-preview` is already enabled from another source, explain the duplicate and preserve their existing app workspaces; don't run two competing copies or uninstall unrelated plugins.
4. Confirm the installed catalog version, all five profiles, tools/list and a harmless guide lookup. Registering a marketplace is not proof that a plugin is installed or enabled.
5. Follow the installed `skills/m5stack-preview/SKILL.md`, or the same file under `plugins/m5stack-preview` when preparing source. Read `docs/AGENT-GUIDE.md` for the end-to-end app workflow.

## Building a user's app

- Start by asking what the user wants to build, unless they already described it. Let their idea determine the interface and required features, then help choose an exact supported profile. Do not prescribe a bundled app, community project or hardware purchase. The default goal is their app in Chrome, with no physical device required. The embedded Codex panel is outside this release; do not route new users there. Don't ask about hardware again after their route is known.
- Treat the plugin as read-only. Create a separate workspace with `scripts/create_workspace.py --destination <new-directory>`. Preserve existing app edits. Run doctor, explicit pinned dependency setup, then the selected native build. Never claim the illustrative input preview is a compiled app.
- Open the compiled app using `sh <plugin-root>/server/launch.sh --browser --workspace <app-workspace> --profile <profile> --app custom`. This uses the same runtime selection as MCP and does not require bare `node` on the terminal PATH when a compatible bundled runtime exists. Keep the process alive and give the user its exact local URL.
- Edit the workspace's `src/user_app.hpp`, `src/user_draw.hpp` and app assets/services. Read the relevant microphone, speaker, network or hardware reference before implementing that feature.
- Keep one shared emulator shell. Apps own their framebuffer, hit regions, button actions, recording controls, processing, errors and results. No app-specific webpage, external Record/Send/transcript controls, image picker or app picker. Generic host audio settings stay compact; diagnostics stay in Runtime.
- Use Chrome and the same shell for microphone apps. Capture requires app demand plus a completed device gesture and browser/OS permission. Never bypass permission or silently restart after hide/denial. The mic provides PCM; transcription is a separate, app-owned service with explicit data handling.
- Use community discovery when the user wants inspiration or reusable source, or when a substantial feature would benefit from prior work. Keep it focused on their idea; do not make catalog search or choosing an existing app a required onboarding step. Follow the packaged discovery guide, credit authors and links, and inspect licenses and actual source before reuse. A catalog binary cannot run in this simulator.
- Verify the changed behavior, then report which checks were source tests, native simulation, real browser capture or physical hardware. Don't repeat broad suites without a new reason. Never claim full firmware/peripheral fidelity.

## Optional physical deployment

Only perform USB work when requested. Confirm exact SKU/identity, check declared capabilities, preserve a verified private backup, build firmware from the app source, install and verify startup. Native desktop executables are not flashable. Use the hardware tool; poll long operations by their operation ID instead of repeating them. Respect a user's hardware-testing pause.

Keep Wi-Fi credentials and service tokens in the owner-only local file prepared by the workflow. Never put them in chat, code, command arguments, logs, this repository or release archives. Don't automatically replay POST requests after interruption.

## Maintaining the plugin itself

Only explicit plugin/emulator changes authorize edits under `plugins/m5stack-preview`. Read `CONTRIBUTING.md`. Preserve the `m5stack-preview` identity, existing contracts and upstream notices. Update the shared device registry and regenerate the C++ table for profile changes. Keep app experiments and provider integrations outside the base package.

Run the focused regression suite for the affected code; rebuild committed bundles and dependency notices, regenerate package hashes, and validate a clean extraction. Never package credentials, recordings, flash dumps, development toolchains or personal evidence. Publishing a repository/release or posting on social media requires user authorization; preparing local files does not publish them.
