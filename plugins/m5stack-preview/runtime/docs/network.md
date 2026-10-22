# Portable app networking

The app owns its screen and connect/request/cancel actions. The emulator shell has no app-specific network page. v0.7.35 makes the optional adapter available on all five emulator profiles and in the CoreS3 SE, AtomS3R and StickS3 firmware targets. Atom Wi-Fi has prior physical acceptance. On October 20, CoreS3 SE and StickS3 both passed public HTTPS GET/JSON POST, physical input, private provisioning, pause, forget/reprovision and a complete power cycle with persisted settings. StickS3 ran on battery; SE used USB for power without a Mac API server. Atom still needs regression of the new forget/reprovision operation. CoreS3 standard and StickC Plus2 still have no physical firmware target. BLE, raw sockets, app-controlled Wi-Fi scanning, captive portals, RF behavior and lossless radio timing are not implemented.

## One application, two transports

The same C++ app uses `NetworkPort` in both targets. In the emulator, a trusted local Node adapter uses the computer's network. On the three firmware targets, the device uses its own 2.4 GHz Wi-Fi and Arduino HTTPClient. The physical device does not tunnel requests through USB. After provisioning, it can call a public API without the Mac, Chrome, Codex or a local server running. It still needs power and a reachable network. StickS3 has a battery; a bare CoreS3 SE or AtomS3R needs another power source. A public app backend, when required, is separate from this plugin. An app backend must be reachable from the device: `127.0.0.1` on the board refers to the board, not the developer's computer.

The emulator's `connect()` marks host transport ready; it does not associate with a Wi-Fi access point or prove internet connectivity. Firmware waits for real association. A response's `source` distinguishes `host` and `wifi`. API responses and errors return to the app, which renders its own result. The browser receives the native framebuffer; credentials never enter browser or worker packets.

Include `network_io.hpp`; opt in with `static constexpr unsigned network_adapter=1`, provide mutable/const `network()` accessors returning a `NetworkPort`, and implement `onNetworkResult(const NetworkResult&)`. The runner first accepts a matching result into the port, then calls the app callback. On app input, use:

```cpp
network().connect();
// After the successful connection callback:
network().request("api", "GET", "/status");
network().request("api", "POST", "/events", "{\"value\":42}");
network().cancel();       // Discard the pending operation; keep connection intent.
network().disconnect();   // Cancel pending work and disconnect.
```

There is one operation in flight. Request IDs are monotonic for an app lifetime. Cancelled/replaced IDs cannot update the app. Cancellation does not undo a POST already received by a server. Do not automatically retry mutations; use application-level idempotency when needed. HTTP work runs outside the drawing/input task, including on the physical device. A cancelled physical worker may take its socket/handshake timeout to exit; further HTTP work waits for that worker, while UI input remains responsive.

## Codex setup workflow

1. Add `network` to the app's `firmware.json` requirements. This is optional; the default Hello World does not connect to anything.
2. Configure up to four named services in workspace `data/network.json`:

```json
{
  "version":1,
  "services":{
    "api":{
      "origin":"https://api.example.com",
      "caFile":"data/api-root-ca.pem",
      "bearerToken":true
    }
  }
}
```

Use a verified public root CA PEM, maximum 64 KiB. Firmware HTTPS requires it and validates the server certificate and hostname. The desktop can use system trust when `caFile` is omitted, but a portable firmware app needs a CA file. No TLS bypass is provided. The public origin/CA are build inputs. Changing them requires rebuilding. Redirects are rejected so credentials cannot move to a different destination.

3. If authentication or physical Wi-Fi is needed, run the model-only `network-prepare` hardware action with the workspace and exact supported firmware profile. It creates `.local/network-credentials.json` with mode 0600 and preserves an existing file. For an emulator-only workspace, Codex can create the same private file directly. It is already excluded by the workspace `.gitignore`. Have the user fill private values locally; never ask them to paste a password/token into chat. Do not print or read these values into tool output, source, build logs or diagnostics. Example structure (placeholders only):

```json
{"wifi":{"ssid":"ENTER_SSID","password":"ENTER_PASSWORD"},"persistOnDevice":true,"tokens":{"api":"ENTER_SERVICE_TOKEN"}}
```

Use only app-specific, minimally scoped service tokens. The base plugin needs no provider key. For an unauthenticated service omit `bearerToken` and its token entry. Explicit `allowInsecure:true` permits HTTP for a controlled local test endpoint; it provides no transport encryption.

4. Test native app behavior through the existing emulator controls. Build firmware, preserve the verified original backup and install on the confirmed supported board using the standard workflow.
5. Run the model-only hardware action `network-configure`, or `./m5preview hardware network-configure --profile atoms3r --port <port> --serial <serial>`. Always select the actual profile (`atoms3r`, `cores3se` or `sticks3`). It verifies the installed build/profile and exact USB identity before provisioning over USB. Pause an already running network app before changing its credentials; an active request/association refuses reconfiguration. If startup reported `WIFI_CONFIG_REQUIRED`, provision then use the app retry action. It also supplies current time for initial TLS verification. On later power-on the device syncs time through NTP before HTTPS. A network that blocks time sync returns `TIME_NOT_SYNCED`; do not disable certificate checks.
6. `persistOnDevice:true` stores the Wi-Fi credentials and configured service tokens in ESP32 NVS, outside the app binary. This initial adapter does not enable flash encryption. With `false`, supplied fields are kept in RAM and corresponding persisted fields removed. Tokens are stored by a stable service-name key, not service order. Do not package credentials, private flash backups or app backend data.
7. Check matching API response bytes in the emulator and on hardware, physical button responsiveness, disconnect/cancel and a fresh power-on/reconnection. Monitor returns only safe status/counters, never SSIDs/passwords/tokens or response bodies.

## Reconnection and forgetting settings

For apps that should connect at startup and recover after transient failures, include `network_connection.hpp`. Keep a `NetworkConnection` member, call `start(network())` in the app constructor, opt in with `static constexpr unsigned timer_adapter=1`, and call `connection.tick(network(), now)` from `void onTick(uint32_t now)`. When it returns true, the app may issue its next request if none is pending. Call `connection.stop(network())` when the user/app wants to disconnect. Legacy apps without the timer opt-in are unchanged.

Firmware calls the timer in its normal input loop. Native simulation calls it on framebuffer/input/result polls; it is not a real-time timer and does not keep running with a stopped preview. Keep callbacks fast and nonblocking. The helper retries connection with a 1–30 second backoff, stops on missing/invalid configuration or authentication failures, and requires an explicit `start()` after correction. Link loss is discovered on a failed network operation. The helper never replays HTTP requests, especially POST; retry/idempotency belongs to the application.

When the user asks to remove saved settings, run `network-forget` with the matching workspace/profile/USB identity. It disconnects and clears the plugin's Wi-Fi and service-token NVS namespace and RAM. It leaves the private local file untouched for optional reprovisioning. Pause outstanding network work first. This clears plugin-managed settings only, not credentials stored by unrelated firmware. Saving new credentials does not erase app data or the verified original backup.

## Limits and failures

This is a small JSON API adapter, not a complete provider SDK. An OpenAI-compatible JSON request can use a named HTTPS service and a private bearer token when its body/response fit these bounds. Audio uploads, multipart requests, realtime sessions and large model responses need an explicitly implemented app/transport extension; microphone PCM alone does not upload audio.

Only GET and JSON POST; request body at most 1,024 bytes, response at most 8,192 bytes of valid UTF-8. Chunked transfer is decoded. Raw binary, arbitrary headers, uploads, streaming, cookies, websocket/MQTT and BLE are outside this contract. A returned HTTP 4xx/5xx is an HTTP result; the app decides what to show. Transport errors have `status=0` unless headers were received; failed/oversized/invalid bodies are discarded.

Wi-Fi association times out after 15 seconds. Desktop requests have a 12-second total deadline. Firmware uses a 12-second operation budget checked around driver I/O, bounded 8-second connect, 10-second TLS handshake and 12-second read timeouts, and an asynchronous task; driver blocking can delay cancellation/deadline reporting. Do not use this adapter for hard real-time timing.

Errors include `WIFI_CONFIG_REQUIRED`, `WIFI_CONNECT_FAILED`, `WIFI_NETWORK_NOT_FOUND`, `WIFI_AUTH_FAILED`, `TIME_NOT_SYNCED`, `OFFLINE`, `SERVICE_NOT_ALLOWED`, `TOKEN_REQUIRED`, `CONFIG_REQUIRED`, `CONFIG_INVALID`, `TLS_FAILED` (host), `TLS_OR_CONNECTION_FAILED` (device), `CONNECTION_FAILED`, `TIMEOUT`, `REDIRECT_BLOCKED`, `RESPONSE_TOO_LARGE`, and `INVALID_UTF8`. Device TLS/network errors are coarser than host errors. USB `network_status` includes numeric `http_transport_code`, `tls_code`, `request_ms`, and `time_epoch` to distinguish driver failures and an incorrect clock without returning credentials or response bodies. Apps should show a useful retry/reconnect action. The optional workspace manifest `mode:"offline"` is a deterministic host-only offline fixture supplied by Codex, not an emulator UI setting.

## Rollout

Use separate evidence for source tests, emulator requests, firmware builds and physical Wi-Fi acceptance. Do not present a successful compile or host-backed emulator response as a board joining a real access point. Keep app services and the Wi-Fi Check sample outside the base plugin. Network/API tests do not establish BLE support, Wi-Fi RF fidelity, or coverage of the Atom's other unfinished peripherals.

## Connection diagnosis

If the device reports `WIFI_NETWORK_NOT_FOUND`, use the existing hardware monitor with `--command NETCHECK --seconds 20` while disconnected. This bounded asynchronous USB diagnostic reports the number of visible networks and whether the privately configured SSID matches, plus its channel/signal/auth mode and a case-mismatch flag. It never returns SSIDs or BSSIDs. It is a Codex troubleshooting operation, not an app-visible scanner or another emulator button. An active connection/request returns `SCAN_BUSY`.

The Mac may use 5 GHz while the ESP32-S3 uses 2.4 GHz. A Mac-hosted API requires routing between those clients; guest isolation or separate VLANs can block it even after Wi-Fi association. First establish that the device finds/joins the exact 2.4 GHz SSID, then test reachability and TLS. Do not infer a bad password from `NO_AP_FOUND`.

When a local API stops responding after the computer changes networks, re-check its LAN address and the server bind address before blaming the board or TLS. A public endpoint origin is a firmware build input; update it and rebuild both targets when the address changes. A local HTTPS certificate must cover the new address. Preserve TLS verification and private credentials. If available, use a stable LAN hostname or reserved address for repeated hardware development. Verify that both the computer and board can resolve a `.local` name before relying on it; VPNs or local discovery policies may prevent it. During USB/hosted-API acceptance keep the computer awake and unlocked. If USB disappears or the LAN address changes after sleep, re-identify both before retrying; do not erase the device or change security settings.
