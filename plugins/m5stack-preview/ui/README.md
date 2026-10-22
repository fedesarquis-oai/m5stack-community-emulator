# Shared emulator UI

One shell hosts every native app: device selector, supported device controls, reload/stop, compact Audio settings and Runtime diagnostics. App-specific screens/actions live in the framebuffer. No Image picker, external recording/send/transcript workflow, test-tone or app picker is included.

`main.mjs` binds the MCP App; `controller.mjs` serializes interactive requests and frame refreshes. `live-microphone.mjs` and its worklet supply app-requested PCM. `device-media.mjs` handles host sound lifecycle, tones and app-owned PCM via AudioBuffer; `speaker-pcm.mjs` defines bounded packet validation. The 80 ms refresh interval while a speaker clip is active keeps app sound flowing during gestures. Lifecycle controls release media.

The same built HTML runs in the Codex MCP App and the local Chrome host. Browser mic success does not imply host permission support. The base contains no provider integration or application-specific HTML. See runtime/docs/emulator-contract.md and runtime/docs/speaker-output.md.
