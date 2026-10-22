# Troubleshooting

| Symptom | What to do |
|---|---|
| Plugin missing | Confirm the marketplace was added, install/enable the plugin from that source, then restart/reload the host if required. Verify the connected catalog version. Registration alone does not enable a plugin. |
| CLI or Git helper not found during registration | Ask Codex to inspect the supported marketplace CLI and locate the available Codex/Git executables. Register the extracted repository through the documented local marketplace command. If a host helper fails, use that supported CLI route and preserve the error; do not patch the installed cache or remove existing app folders. |
| An old plugin version is still active | Check the connected catalog and enabled source, not only the archive version. Preserve app workspaces, enable one intended `m5stack-preview` source, and refresh/restart the host if required. |
| Only “Input preview” appears | Ask Codex to create, prepare and build a real workspace, then open it. The illustrative view needs no compiler and isn't evidence of a native build. |
| Node version error | Use Node 22 or newer. The launcher reports the selected version and stops; it does not install or silently retry a different runtime. |
| Missing compiler/SDK | Ask Codex to run doctor and explain the missing prerequisite. Install standard tools through their normal process; don't bypass OS security. |
| Dependency setup fails | Read the bounded error and preserve existing vendor files. Do not delete a dirty checkout or repeatedly rerun setup without diagnosing it. |
| Mic fails in the Codex panel | Open the same built app in Chrome. Panel media permission is a host limitation in previously inspected versions. |
| Chrome doesn't capture | Keep the tab active, use an app that requests mic input, click the actual device screen/button, and check browser/OS permission. After denial, restore permission explicitly and use another device gesture; the plugin must not silently retry. |
| Capture stops after switching tabs or changing microphone permission | This is expected cleanup. Return to the app, restore browser/OS permission if needed, then start capture through its device controls. Old recording/playback must not resume by itself. Check Runtime if the app still fails. |
| Mic meter low | Check native sample delivery and recording/playback, not just percentage. The meter isn't calibrated acoustic gain. |
| No speaker sound | Tap the device or press its button to activate audio; if you selected Mute, choose Unmute in Audio settings. Check host volume. The app must request playback. Atom has no audio; Plus2 has a buzzer, not arbitrary PCM output. |
| “Emulator disconnected” / fetch fails | The local launcher may have stopped. Ask Codex to rerun it and use the new URL. Don't reuse an expired link. |
| “Stopped” with disabled controls | Ask Codex to reopen the workspace through the launcher. Reloading the old browser page cannot create a new native session. |
| “Session expired” | Sessions last 30 minutes. Reopen through Codex. Don't repeat an old POST or microphone operation automatically. |
| Hardware app doesn't start after flashing | Flash verification and boot are different. Follow the exact board's reset/download instructions and inspect its build status; don't erase automatically. |
| Physical Stick audio is quiet | This is a known issue. App firmware volume is separate from browser volume; see the hardware guide before changing it. |

## Report a bug

Use the repository's bug-report form. Include plugin version, OS/browser, exact device/profile, whether this is browser/panel/hardware, steps, expected result and a redacted error. A small app reproducer is helpful. Don't attach microphone recordings, API keys, Wi-Fi passwords, capability-token URLs, full flash dumps or private logs.

For a potential security issue, don't post credentials or an exploit containing private data in a public issue. Use GitHub's private vulnerability reporting if enabled; otherwise ask the maintainer for a private channel without including the sensitive details. This is a community project without a guaranteed response time.
