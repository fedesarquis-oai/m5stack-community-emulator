# Data handling

The base plugin has no maintainer-operated cloud backend, user account, telemetry endpoint or transcription service. It runs a local MCP server, a native app process and an optional loopback browser preview. Codex/ChatGPT and Chrome have their own data and permission behavior; this document describes the plugin.

Microphone PCM goes from Chrome to the local bridge and app while the app requests it and permission is granted. The base emulator does not upload it to a transcription provider. App code can store/process it or implement an external service when requested, so review the particular app before using sensitive data. Capture stops on hide, reset/replacement or failure and needs another gesture to reconnect.

App source, assets, build outputs, logs, receipts and optional firmware backups remain in local workspaces until removed. The tool returns selected results to Codex. Native source executes with local process permissions and is not an OS sandbox.

Optional named network services receive the requests the app makes. Initial setup fetches dependencies from upstream sources. Hardware Wi-Fi/service settings are entered in an owner-only local file and provisioned over verified USB; persisted device settings are not encrypted by this workflow. `network-forget` clears plugin-managed settings on the selected device, not the local file, backups or unrelated firmware storage.

Never commit private workspaces, recordings, credentials or flash backups. Public issues are public; redact reports. The maintainer doesn't receive local files unless you choose to share them.
