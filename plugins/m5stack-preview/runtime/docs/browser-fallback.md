# Local browser preview

The plugin includes a local browser host for the same built MCP App and native device controls. Use it for current microphone development and testing. Browser results remain separate from Codex-panel permission support; this surface does not change Codex permissions or bypass an OS denial.

From the installed plugin directory, use the same runtime selection as the MCP server:

```sh
sh server/launch.sh --browser --workspace /absolute/prepared/workspace --profile cores3se --app custom
```

The command prints a temporary `http://127.0.0.1:PORT/#…` URL. Open that exact URL in Chrome. It expires after 30 minutes; Ctrl-C stops its owned preview and native worker. It installs no service, accesses no physical hardware, builds no source and exposes no provider tools. The workspace must already contain a verified current native build.

## Microphone and speaker controls

For rebuilt native apps with `audio_input_adapter:1`, use the device's touchscreen or buttons. The gesture prepares microphone processing; actual capture starts only while the app requests it and the browser permits it. No audio upload is needed for ordinary PCM input.

Audio settings is compact and always visible below the device, showing microphone status and speaker mute/volume. Read-only technical diagnostics are in Runtime. An app that is not requesting input captures nothing. Withdrawal stops the active stream; hide/reset/reload/session changes and failure disarm it. Returning never automatically reopens the microphone. Atom has no audio controls; Input preview does not capture microphone audio.

Sound is on by default and activates on the first device interaction. Mute/Unmute and volume remain available; output is independent of microphone permission. There is no test-tone button. App recording/transcription controls and results belong on the native screen. Legacy clip/fixture APIs remain in source for compatibility but have no external controls in this shell. The generic fallback exposes no provider tools. Application-specific services must be implemented separately when requested.

## Local transport boundaries

The host binds only to 127.0.0.1. Its random capability stays in the URL fragment and is required in API headers. Requests pass exact Host, Origin, optional Fetch Metadata and current-session checks, with a 256 KiB overall body limit. The API forwards only frame/input/audio/select/reload/stop through MCP validation. The audio schema further limits each chunk to 3200 PCM bytes. Audio is single-flight, carries no frame response and never replaces the cached frame/bootstrap result. Frame operations use a separate bounded queue.

Workspace selection is fixed at launch. Build, arbitrary file reads, resource RPC and voice/provider tools are excluded. The browser document permits the bundled fixed Blob AudioWorklet; the installed Codex resource keeps its own CSP and permission metadata. Audio remains local to the bridge/native app, with no host non-retention guarantee.

## Evidence

Earlier releases passed real Chrome microphone input on all four microphone profiles; the latest pre-cleanup live check was StickS3 on v0.7.35 (October 20). The v0.7.38 starter has passed known-PCM native checks on all four profiles. The October 21 walkthrough observed CoreS3 SE PCM delivery but found an overrun after about 39 seconds. Version 0.7.39 increases the bounded jitter window to one second. The user subsequently confirmed microphone response, counter and audible clicks; 0.7.41 subsequently delivered 70.9 seconds of real microphone samples with responsive touch. Manual hide, permission revocation and OS interruption remain pending. Version 0.7.40 was observed in Chrome to activate output from the first device touch and respect explicit mute. See [release validation](release-validation.md). A browser meter alone does not prove native app consumption; verify received sample count and the app's response.

Previously inspected Codex desktop builds rejected media permission at the MCP App host layer even with microphone metadata declared. That historical finding does not establish the behavior of every current build. Confirm the actual host diagnostics before attempting a panel microphone test. Composer voice and speaker playback are separate capabilities.

## Reopening a stopped preview

Preview links are temporary and expire after 30 minutes. Keep the launcher running. If its local server exits, the browser shows **Emulator disconnected**; if its known deadline has passed, it shows **Session expired**. Rerun the emulator from Codex or the local launcher and open the new link. **Check connection** makes a read-only availability request and never repeats a device action or audio submission. Hiding the page releases the microphone; returning requires a new device gesture. Sleep can outlast the preview deadline, but an unreachable server alone does not establish that locking caused the failure.
