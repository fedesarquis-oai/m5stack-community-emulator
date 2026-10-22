# Install and build your app

The supported community-preview setup is **Codex on macOS Apple Silicon + Chrome**. Other operating systems and browsers have not completed end-to-end validation. Workspace administrators may restrict custom plugins; follow their controls. A physical M5Stack device is optional.

## Let Codex handle setup

Copy [the repository URL](https://github.com/fedesarquis-oai/m5stack-community-emulator) into a new Codex chat and ask:

> Install the M5Stack Community Emulator from this GitHub repository using Codex’s supported plugin marketplace commands. Read its installation guide, check this computer’s prerequisites and verify the active plugin version. Then ask what I want to build. Help me choose a supported device, create my app in a separate workspace, and build and test it in Chrome using the existing emulator.

Codex can register the GitHub source directly; you do not need to clone it or type terminal commands. It should explain any required system-tool installation and use the normal approved installer. You still need to approve browser/OS permission prompts for features such as the microphone.

If you already downloaded or cloned the repository, open its folder in Codex and ask:

> Read AGENTS.md and docs/INSTALL.md. Install this community plugin through the supported local marketplace flow and verify the active version. Then ask what I want to build. Help me choose a supported device, create my app in a separate workspace, and build and test it in Chrome using the existing emulator.

Codex should ask about your idea before choosing an app or device for you. If you already described the app or named a board, it should continue from that information. It can recommend a supported profile based on the controls and features your app needs. You do not need to build an example or select a community project first.

The public repository contains the plugin and setup instructions. A local emulator URL is private to the computer running it and is not the installation link.

The repository includes ready-built JavaScript bundles. Users do not need to install the plugin's npm/pnpm dependencies. Native device apps still need a compiler and pinned library sources.

## Manual installation

To install from the public GitHub source:

```sh
codex plugin marketplace add https://github.com/fedesarquis-oai/m5stack-community-emulator
codex plugin add m5stack-preview@m5stack-community
```

Or, from a downloaded/cloned repository's root, with Codex CLI available:

```sh
codex plugin marketplace add .
codex plugin add m5stack-preview@m5stack-community
```

Restart/reload Codex if it asks. Alternatively, after marketplace registration, open the plugin directory, select **M5Stack Community**, and install/enable **M5Stack Community Emulator** there. Start a new chat and mention the plugin if the current chat has not picked it up. Repository registration alone is not installation.

If the CLI isn't on the shell's PATH, ask Codex to locate the CLI supplied by the desktop app and inspect its supported plugin commands. If it is unavailable, use the host's supported Plugin Creator/local marketplace flow. Don't copy files into the installed cache. If you already use a development copy with internal ID `m5stack-preview`, keep one intended source enabled and preserve all app workspaces before replacing that source. Never remove unrelated plugins.

Verify by asking: “Show this plugin's active version and supported devices.” This candidate reports **0.7.42** and five profiles. Check the connected plugin's catalog, not just a file on disk. Unknown boards must stay unsupported rather than being silently mapped to a similar device.

## Prerequisites

| Requirement | Used for |
|---|---|
| Existing Node.js 22+ | Local MCP server and Chrome preview; launcher can use a compatible runtime bundled with the desktop host |
| Python 3.9+ and Git | Workspace creation, pinned dependency setup and build coordination |
| Clang/Clang++ and platform headers | Compile native C/C++ app code; normally provided by Apple's Command Line Tools |
| Chrome | Browser testing, microphone permission and playback |
| Internet for initial setup | Fetch the pinned upstream native libraries |

Ask Codex to run `m5stack_doctor`. It reports paths/presence, not a successful build. If system tools are missing, use their normal installation process; don't disable OS security or substitute another interpreter after a security denial. No API key is needed unless your app uses a service that requires one.

## Build in a separate workspace

After understanding your idea and selecting the profile, Codex resolves the installed plugin root and creates a new writable workspace outside it:

```sh
python3 /absolute/plugin-root/scripts/create_workspace.py --destination /absolute/new-app
cd /absolute/new-app
./m5preview doctor
./m5preview setup --browser-only
./m5preview web-build --profile <selected-profile>
```

Substitute the profile Codex selected with you: `atoms3r`, `stickcplus2`, `sticks3`, `cores3` or `cores3se`. The parent directory must exist; the helper refuses to overwrite a project. The generated files provide a technical scaffold, which Codex edits into your app. Existing app workspaces stay separate from the plugin and its updates.

Setup downloads pinned native source into that workspace and may take a few minutes. It does not install system tools. Run only source you trust: the native app runs with your local process permissions.

Then ask Codex to open your built workspace in Chrome. The equivalent launcher, from the plugin root, is:

```sh
sh server/launch.sh --browser --workspace /absolute/new-app --profile <selected-profile> --app custom
```

The shell launcher uses the same approved Node runtime selection as the plugin, so Node does not have to be on the terminal PATH when a compatible bundled runtime is found.

Open the exact `http://127.0.0.1:PORT/#…` URL the launcher prints. Keep that process running. The link expires after 30 minutes and is private to your computer; don't share it as the plugin's download link. Use this launcher, not the historical `m5preview web` viewer.

The screen should say **Native app**, and show the app Codex built from your idea. Test its actual controls and requested features. An **Input preview** is only an illustrative control view and does not prove your source compiled. For microphone apps, allow Chrome's prompt after a device gesture, check native sample delivery and listen to any playback your app uses. Sound is on by default and starts with device interaction; Audio settings keeps Mute/Unmute and volume available.

## Optional physical installation

When you are happy with your app, ask Codex to install it on a **CoreS3 SE K128-SE, AtomS3R C126 or StickS3 K150**. Codex must confirm the exact device, preserve and verify a private backup, compile firmware from your app source, install it, and verify startup. Test the app on the device before calling that deployment complete. CoreS3 standard and StickC Plus2 remain emulator-only in this release. Read the [support matrix](SUPPORT-MATRIX.md) for feature limits.

## Updates and removal

Keep app projects in their own directories. For a Git-backed marketplace, use `codex plugin marketplace upgrade` (or its supported named-marketplace form), then refresh/restart the host as needed and verify the active version. For a local extracted repository, replace/update the source directory while preserving your app workspaces and use the host's supported refresh/reinstall flow.

Disable/uninstall the plugin in the host. Removing its marketplace source does not delete your separate app projects, recordings, private credentials or hardware backups. Manage those files separately. See [troubleshooting](TROUBLESHOOTING.md).
