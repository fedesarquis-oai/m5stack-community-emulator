# Share from GitHub

Share [the public GitHub repository](https://github.com/fedesarquis-oai/m5stack-community-emulator). It contains the ready-built plugin, marketplace catalog, installation guide and agent instructions. People do not need a sample app, physical device or manual Git clone.

## What the recipient does

1. Open Codex on a supported Mac.
2. Paste the repository's actual GitHub URL and ask:

   > Install the M5Stack Community Emulator from the GitHub repository I linked, using Codex’s supported plugin marketplace flow. Read its installation guide, check this computer’s prerequisites and verify the active version. Then ask what I want to build. Help me choose a supported device, create my app in a separate workspace, and build and test it in Chrome using the existing emulator.

3. Describe their own idea and try the resulting app in Chrome.

Codex registers the Git marketplace, installs the plugin, verifies its active catalog, prepares a separate app workspace, downloads the pinned native libraries and compiles the user's app. The person may need to complete normal system-tool installation or browser/OS permissions. Plugin updates leave separate app workspaces intact.

State the supported setup with the link: **community preview for macOS Apple Silicon, Codex and Chrome**. Node 22+, Python 3.9+, Git, Clang and platform headers are needed; the launcher can use a compatible desktop-bundled Node runtime. Internet is needed for the first dependency download. See [installation](INSTALL.md).

This is an independent community project, not an official M5Stack or OpenAI product. The emulator reproduces the implemented app interfaces for five exact profiles. It does not execute arbitrary ESP32 firmware or simulate every peripheral. Physical installation is optional and limited to the three targets in the [support matrix](SUPPORT-MATRIX.md).

## Publish the reviewed tree

Choose the owner and repository name before creating a public repository. Publish only the reviewed distribution tree with the MIT license, upstream notices, committed server/UI bundles and setup documents. Do not upload development history, app workspaces, recordings, credentials or device backups.

Create a versioned community-preview release for **v0.7.42**. Optional release attachments are the repository ZIP and its matching SHA256SUMS; the plugin-only ZIP is mainly for maintainers.

After publication, check the real GitHub URL, clone it into a new directory, verify package hashes, start its MCP server and confirm version 0.7.42, 14 tools and five profiles. Check the first GitHub Actions result. Do not call a local Git clone or a prepared ZIP a completed public installation.

The 0.7.42 source was published on October 22, 2026. A fresh public HTTPS clone passed package verification and MCP startup, and the [first GitHub Actions run passed](https://github.com/fedesarquis-oai/m5stack-community-emulator/actions/runs/39816856736). The downloaded tree matched the reviewed local tree. These checks do not establish setup on another person's Mac.

## ZIP fallback

If a recipient prefers downloading files, send **m5stack-community-emulator-v0.7.42.zip** and SHA256SUMS. They extract the ZIP, open its folder in Codex and use the local-folder prompt in [INSTALL.md](INSTALL.md). The smaller plugin-only ZIP lacks the repository onboarding files.

A localhost preview URL only works on the computer running the emulator and contains a private capability. Share the GitHub repository link instead.

## First independent tester

Have someone on another macOS Apple Silicon computer follow the instructions using their own app idea. Record the host/tool versions, active plugin version, setup result and whether the app builds and runs in Chrome. Keep this check pending until it actually happens.

The [validation record](VALIDATION.md) and [release checklist](RELEASE-CHECKLIST.md) distinguish current checks, historical hardware acceptance and remaining manual audio-interruption work.
