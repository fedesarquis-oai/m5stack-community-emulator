# Share from GitHub

Share [the public GitHub repository](https://github.com/fedesarquis-oai/m5stack-community-emulator). It contains the ready-built plugin, marketplace catalog, installation guide and agent instructions. People do not need a sample app, physical device or manual Git clone.

The default `main` branch provides **v0.7.44**, including portable setup, the standard CoreS3 build target and all eight exact-SKU kit guides. Builders can use the repository link directly; no review branch or ZIP is required. Native setup/build CI passed on Windows x64, Ubuntu x64 and macOS 26 ARM64. Independent Windows/Linux Codex and live Chrome acceptance remain pending; see the [validation record](VALIDATION.md).

## What the recipient does

1. Open Codex. macOS Apple Silicon + Chrome is the accepted setup; Windows/Linux users should read the remaining checks in [builder readiness](BUILDER-READINESS.md).
2. Paste the repository's actual GitHub URL and ask:

   > Install the M5Stack Community Emulator from the GitHub repository I linked, using Codex’s supported plugin marketplace flow. Read its installation guide, check this computer’s prerequisites and verify the active version. Then ask what I want to build. Help me choose a supported device, create my app in a separate workspace, and build and test it in Chrome using the existing emulator.

3. Describe their own idea and try the resulting app in Chrome.

Codex registers the Git marketplace, installs the plugin, verifies its active catalog, prepares a separate app workspace, downloads the pinned native libraries and compiles the user's app. The person may need to complete normal system-tool installation or browser/OS permissions. Plugin updates leave separate app workspaces intact.

State the supported setup with the link: **community preview for macOS Apple Silicon, Codex and Chrome**. Node 22+, Python 3.9+, Git, Clang and platform headers are needed; the portable MCP command requires Node on PATH; the legacy Unix browser wrapper can still locate a compatible macOS bundled runtime. Internet is needed for the first dependency download. See [installation](INSTALL.md).

This is an independent community project, not an official M5Stack or OpenAI product. The emulator reproduces the implemented app interfaces for five exact profiles. It does not execute arbitrary ESP32 firmware or simulate every peripheral. Physical installation is optional and limited to the four implemented targets, with CoreS3 physical acceptance still pending, in the [support matrix](SUPPORT-MATRIX.md).

## Maintainer updates

Publish only reviewed changes to this repository with the MIT license, upstream notices, committed server/UI bundles and setup documents. Keep app workspaces, recordings, credentials and device backups outside it. A future versioned GitHub Release can provide a pinned archive, but builders do not need a Release to install from `main`. This community source is separate from an official plugin-directory submission.

For each update, verify the public checkout, package hashes, MCP startup, active version and CI. A successful source checkout is not a completed installation on another person's computer. Earlier publication evidence remains in [VALIDATION.md](VALIDATION.md).

## ZIP fallback

For a file-based handoff, prepare **m5stack-community-emulator-v0.7.44.zip** and matching SHA256SUMS from the reviewed tree. They extract the ZIP, open its folder in Codex and use the local-folder prompt in [INSTALL.md](INSTALL.md). The smaller plugin-only ZIP lacks the repository onboarding files.

A localhost preview URL only works on the computer running the emulator and contains a private capability. Share the GitHub repository link instead.

## First independent tester

Have independent testers on macOS, Windows x64 and Linux x64 follow the installation instructions using their own app ideas. CI has validated native builds; it does not replace live Codex/Chrome acceptance. Record the host/tool versions, active plugin version, setup result and whether the app builds and runs in Chrome. Keep this check pending until it actually happens.

The [validation record](VALIDATION.md) and [release checklist](RELEASE-CHECKLIST.md) distinguish current checks, historical hardware acceptance and remaining manual audio-interruption work.
