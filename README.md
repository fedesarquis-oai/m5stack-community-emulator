# M5Stack Community Emulator

Tell Codex what you want to build, then develop and test your device app in Chrome.

This community plugin gives Codex a fixed emulator and a portable C++ app workspace. Tell it what you want to build; Codex edits the app, builds it and opens the result. When you have a supported physical device, Codex can compile the same app source for that board and guide installation.

**Community preview · v0.7.42 · tested on macOS Apple Silicon with Chrome.** No hardware or API key is required for the base emulator. This is an independent project, not an official M5Stack or OpenAI product. It simulates supported app interfaces; it does not run arbitrary ESP32 firmware or reproduce every peripheral.

Original code is available under the [MIT license](LICENSE). Upstream components retain their own notices.

## Start with your idea

1. Copy this repository’s GitHub URL into a new Codex chat.
2. Paste this:

   > Install the M5Stack Community Emulator from the GitHub repository I linked, using Codex’s supported plugin marketplace flow. Read its installation guide, check this computer’s prerequisites and verify the active version. Then ask what I want to build. Help me choose a supported device, create my app in a separate workspace, and build and test it in Chrome using the existing emulator.

3. Describe your idea. Codex will work out the screen, controls and features with you, choose the matching device profile, and build your app in its own folder.
4. Try the app in Chrome and tell Codex what to change. Hardware is optional; ask for installation only when you want to move your app to a supported physical device.

You do not need to clone the repository or type the installation commands yourself. Codex handles plugin installation, dependency preparation and compilation. The first build downloads pinned native dependencies. Existing Node 22+, Python 3.9+, Git and Clang/platform headers are needed; [installation](docs/INSTALL.md) covers missing tools and the manual route.

The workspace includes the technical scaffold needed to compile an app. Your idea determines what gets built. Community project research is available when you want inspiration or reusable source; it is not a required starting point.

## Supported app features

- Draw an interface and use the selected device's supported touch or buttons.
- Receive live microphone PCM in Chrome while keeping app controls responsive.
- Play app-generated audio on speaker-equipped profiles, or buzzer tones on StickC Plus2.
- Call named HTTP(S) services through the optional network adapter.
- Compile the same portable app source for one of the three supported physical targets.

Microphone use requires your app to request it, a device interaction and browser/OS permission. Recording controls and results stay on the device screen. Transcription and AI providers are separate app features with their own setup and data handling.

## Devices

| Device | Screen and controls | Browser microphone | Audio output | Physical deployment |
|---|---|---|---|---|
| AtomS3R C126 | Display-cap button, semantic tilt/shake | No onboard mic | No onboard speaker | Tested |
| StickC Plus2 K016-P2 | A/B buttons, semantic tilt/shake | Yes | Buzzer tones | Not implemented |
| StickS3 K150 | KEY1/KEY2, semantic tilt/shake | Yes | Speaker PCM/tones | Tested; speaker volume needs improvement |
| CoreS3 K128 | Touch, semantic POWER, tilt/shake | Yes | Speaker PCM/tones | Not implemented |
| CoreS3 SE K128-SE | Touch/lower strip, semantic POWER | Yes | Speaker PCM/tones | Tested |

All five have an optional network adapter. CoreS3 SE has no IMU or camera. Browser microphone support is separate from Codex's embedded panel, where capture has been blocked by the host. **Use Chrome for microphone apps.** See [tested scope and limits](docs/SUPPORT-MATRIX.md).

## For people and agents

- [Install and build your first app](docs/INSTALL.md)
- [Agent workflow and boundaries](AGENTS.md)
- [App authoring guide](docs/AGENT-GUIDE.md)
- [Supported features and device evidence](docs/SUPPORT-MATRIX.md)
- [Current candidate validation](docs/VALIDATION.md)
- [Troubleshooting and bug reports](docs/TROUBLESHOOTING.md)
- [Contributing and reproducible builds](CONTRIBUTING.md)
- [Data handling](docs/DATA-HANDLING.md)
- [Source credits](CREDITS.md)
- [Changes in this version](CHANGELOG.md)
- [Share the preview](docs/SHARING.md)

Keep app projects outside this repository. Don't put API keys, Wi-Fi settings, microphone recordings or firmware backups in an issue or pull request. You can use the emulator without a physical device; USB operations happen only when you request them.
