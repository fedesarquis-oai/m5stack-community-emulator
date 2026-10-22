# M5Stack app runtime — v0.7.42

Portable application model/drawing plus a native C++ renderer. Profiles: AtomS3R C126, StickC Plus2, StickS3 K150, CoreS3 and CoreS3 SE. This is not ESP32 instruction-set emulation.

Read [getting started](docs/getting-started.md), [app API](docs/generic-app.md), [microphone input](docs/microphone-input.md), [speaker output](docs/speaker-output.md), [networking](docs/network.md) and [hardware workflow](docs/hardware-workflow.md).

Codex edits `src/user_app.hpp`, `src/user_draw.hpp` and app assets in a separate workspace, builds the selected profile and opens it in the plugin's fixed shell. Capture/recording/results belong on the native app screen or supported buttons. Base audio is PCM; provider integrations are separate app services.

Use existing tools. Run `./m5preview setup --browser-only`, then `./m5preview web-build --profile cores3se`. Open the compiled workspace with the installed plugin or its Node browser launcher. Only the plugin’s shared browser/panel shell is supported; old SDL/Python viewers and unrelated sample apps have been removed.

Physical targets are CoreS3 SE, AtomS3R and StickS3 for the implemented features. Firmware builds compile the portable app source against a separate adapter; the desktop executable cannot be flashed. Preserve [source notices](THIRD_PARTY_NOTICES.md).
