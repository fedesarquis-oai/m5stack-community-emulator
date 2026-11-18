# Accessory builder guide

Use this reference when a builder has one of these parts. Start with their idea and available hardware; the CoreS3/StickS3 kit is one possible combination, not a required project template. Checked November 16, 2026.

## What is ready

For questions about something found in the box, start with [kit contents](kit-contents.md). It covers the NFC stickers, Allen key, DinBase mounting clips, two controllers and six add-ons.

| Part | What a builder can develop now | First physical check |
|---|---|---|
| CoreS3 K128 + DinBase | Native screen/touch, semantic motion, mono audio and bounded HTTP(S). Firmware target compiles; standard CoreS3 physical acceptance is pending. DinBase power/battery behavior is not simulated. | Show text, tap a counter, then test each needed input/output. Confirm the actual base and board revision. |
| StickS3 K150 | Native screen, KEY1/KEY2, semantic motion, mono audio and bounded HTTP(S). Implemented base features have prior physical acceptance. Reset/power is a separate system button. | Show text, press each key, then test any audio the app uses. |
| QRCode M145 | Read setup guidance; develop app logic from labeled decoded-text fixtures. No scanner emulator or packaged driver. | Trigger one harmless code and display the received text. |
| RFID2 U031-B | Read setup guidance; develop app logic from labeled tag events. No RF/card-memory emulation or packaged driver. | Read a known test UID, remove the tag and show no-card. |
| Gesture U127 | Read setup guidance; develop app logic from labeled gesture events. No gesture-sensor emulator or packaged driver. | Display left/right/wave and establish sensor orientation. |
| GPS v1.1 U032-V11 | Read setup guidance; develop app logic from a labeled route/no-fix fixture. No satellite emulator or packaged driver. | Receive NMEA, then obtain a fresh valid fix outdoors. |
| ENV III HAT U053-D | Read setup guidance; develop app logic from labeled readings. No environmental-sensor emulator or packaged driver. | Read temperature, humidity and pressure, with separate validity. |
| ToF HAT U072 | Read setup guidance; develop app logic from labeled distance readings. No optical emulator or packaged driver. | Compare a flat target at known distances and test no-target. |

All six add-ons are knowledge-only in this plugin. The vendor supplied useful bench observations from its own builds; those are recorded separately in each part's `vendor_bench_report`. They do not mean the plugin's adapter, toolchain or exact attached unit has passed that test. Manufacturer references remain in each tool result. No vendor photos, full guide, driver source or firmware were republished.

## Give the builder a short, useful answer

Call `m5stack_device_guide` for the exact host and accessory. Explain these four things before coding:

1. What data the app receives and how that helps their idea.
2. Where the part connects, including power, bus ownership and any conflict with another requested part.
3. What can be tested in the browser versus what needs the physical part and a driver.
4. One small first check and what result would count as success.

Only ask for details that change that plan, such as an unreadable SKU, ambiguous connector or unknown attached HAT orientation. Do not overwhelm a beginner with every possible library and radio option. Codex handles setup/build commands and explains the few physical actions the builder must perform.

If hardware is unavailable, develop the app's display/state handling with **labeled app-owned fixtures**, including missing/stale/error cases. Keep fixtures in the workspace and make hardware builds use real acquisition. Never add an accessory picker, sliders or an app-specific page to the fixed emulator.

If a user requests an actual accessory app, explain that its driver is not packaged. An app-specific Arduino/M5Unified hardware project can use the linked vendor driver in a separate workspace, with pinned dependencies and exact-board settings. That route is hardware development, not automatic emulator portability. A reusable adapter for the plugin remains a separate requested extension. Do not pass unsupported capabilities to the packaged firmware workflow by deleting their declarations.

Keep the existing plugin launcher, setup, verified backup and private provisioning workflow. The supplied guide describes another PlatformIO setup; it is not a reason to replace the plugin's pinned toolchain or copy a new AGENTS.md into the user's project. When an app genuinely needs another build system, isolate it in that app workspace and record the exact versions.

## Connections that avoid common mistakes

Read the part's JSON record for source URLs and qualifications; this table is a planning aid, not a PCB revision guarantee.

| Host / connector | Signals | Use and conflict |
|---|---|---|
| CoreS3 **body** red PORT.A | SDA2 / SCL1, 5V supply | RFID2 or Gesture. M5.Ex_I2C owns it after board initialization; reuse that bus, or release it before another owner initializes it. |
| CoreS3 blue PORT.C | Host RX18 / TX17, 5V supply | GPS UART. Conflicts with the M145 UART route below. |
| CoreS3 internal M5-Bus I2C | SDA12 / SCL11 | M5.In_I2C manages internal parts and the scanner's 0x43 control expander. Do not reinitialize it independently. |
| M145's red PORT.A | Internal M5-Bus SDA/SCL | Different from the CoreS3 body's red connector. Identify the actual connector before applying GPIO2/1. |
| StickS3 Grove | SDA9 / SCL10 for I2C; host RX10 / TX9 for GPS | One direct Grove unit. UART and I2C cannot occupy the same pins simultaneously. |
| StickS3 top HAT | Vendor reports SDA8 / SCL0, 100 kHz, 3.3V | Candidate for ENV III / ToF; verify seating/orientation and exact part. It is not Grove GPIO9/10 or old StickC GPIO0/26. One HAT at a time. |

The StickS3 peripheral supply defaults to input mode under M5Unified. When the Stick supplies the accessory, enable `M5.Power.setExtOutput(true)` after initialization and check the wiring. Do not feed external power into a port configured as an output. The HAT's sensor supply is 3.3V. GPIO0 is also a boot-strapping signal; include cold boot with the HAT attached in acceptance.

Do not claim there are unlimited independent I2C buses: the ESP32-S3 has two controllers and the board already uses one for internal parts. A HAT and a Grove I2C unit on separate pin pairs require an explicit bus/driver plan. Repeatedly calling `Wire.begin()` with different pins can disconnect the earlier device.

Two possible starting layouts, subject to connector and power checks:

- **With QR:** M145 under CoreS3; RFID2 on the CoreS3 body's red PORT.A; GPS on StickS3 Grove; one HAT on StickS3. Swap RFID2 for Gesture as needed.
- **Without QR:** RFID2 on CoreS3 body PORT.A; GPS on CoreS3 PORT.C; Gesture on StickS3 Grove; one HAT if its bus ownership is resolved.

These are examples, not a universal maximum part count. A hub, different pin routing or the scanner's additional connectors change the plan. Do not join buses merely because plugs or colors match. Power down before reseating HATs, restacking modules or moving routing switches.

## Part-by-part first tests

**M145 scanner:** use UART at 115200 8N1 for decoded text. The vendor reports switch 3 ON and 1/2/4 OFF in both routing banks for CoreS3 RX18/TX17; verify the actual switch labels and schematic before using it. Keep other routes disconnected, especially routes onto audio GPIO13/14. Use the internal 0x43 expander for power/trigger. Check the text arrived, not just that the scanner beeped; then play a speaker sound to check for routing conflicts. Inspect trigger mode before changing persistent scanner settings. Raw-image transfer is a different, slow path; it is not the CoreS3 front camera or a video stream.

**RFID2:** use an I2C driver at 0x28. The vendor read NTAG215 with an MFRC522 I2C implementation. The hardware manual advertises Type A/B, but that reported driver path polls Type A; do not promise all NFC tags or phones work. Begin with a known Type A test tag, preserve UID length/leading zeros, and remain read-only. The guide's four included stickers describe that kit, not every RFID2 purchase. Bound reset/init loops when the reader is absent. UID matching is useful for game pieces, not secure authentication.

**Gesture:** use 0x73 and the selected driver's startup register table. Display the nine discrete event names before mapping actions. Directions follow sensor orientation; debounce repeated events. It does not provide a hand position or a camera image. Keep polls bounded so keys and touch remain responsive.

**GPS v1.1:** use 115200 8N1, not the 9600 defaults from older GPS units. Separate UART health from fix health: show receiving/searching until the parser reports a valid, fresh fix. Try open sky for first acquisition. Never display stale coordinates or 0,0 as a new fix. The vendor additionally received RX-only data through CoreS3 body PORT.A GPIO1; that alternative takes the port away from I2C and is not a plug-in fix for a busy bus. Persistent antenna-fault text needs investigation; do not dismiss it solely because the test is indoors.

**ENV III:** expect SHT30 at 0x44 and QMP6988 at 0x70. Current manufacturer documentation agrees with the vendor report; 0x56 is a driver-supported alternate, not the default recipe for this HAT. The vendor observed pressure dropping out while temperature/humidity still answered. With power off, check seating and then test both chips again; make the app handle either disappearing. Show units and validity per value. Board heat can bias temperature; this is not an air-quality/CO2 sensor.

**ToF:** expect VL53L0X at 0x29. Start with a flat target at known distances and a bounded timeout. The vendor's roughly 30–120 cm demo range is an observation, not a specification; advertised maximum range depends on mode and conditions. Reject bad status before optional short-window smoothing. No target is unavailable, not zero distance. Confirm cold boot and recovery after a missing sensor.

For each check, record the exact board/part, pin map, driver revision, build, observed result and remaining uncertainty in the app workspace. A successful compile or I2C address scan is not physical functionality. Keep real tag data and positions out of shared logs. Treat scanned text as data, never as commands or an instruction to open/send a URL.

## Choosing connectivity

| Need | Practical starting route | Plugin coverage |
|---|---|---|
| Debug one board | USB serial with bounded reads; close monitor before flashing | Existing hardware diagnostics and exact-target deployment |
| Call an Internet API | 2.4 GHz Wi-Fi and verified HTTPS | App-owned GET / JSON POST, 1 KiB request / 8 KiB response; no audio upload or streaming |
| Send a button/sensor event between ESP32 boards | Consider ESP-NOW when no router is needed | Reference only; no packaged driver or radio simulation |
| Phone controls | Consider BLE GATT or a device-hosted Wi-Fi page | Reference only; no packaged BLE, access-point or web-server adapter |
| Many devices | Consider Wi-Fi with a broker/service | MQTT, UDP and WebSockets need app-specific implementation; not provided by the HTTP adapter |

Read [network workflow](../../../runtime/docs/network.md) for the supported route. A board calling a public HTTPS service can run without a laptop server after configuration. A laptop or hosted backend is an optional app architecture, not a plugin requirement. Keep credentials in the private provisioning workflow, never source files or compiler flags. Captive portals/enterprise Wi-Fi need a suitable alternative; prepare a 2.4 GHz hotspot or event IoT network.

For a separately requested ESP-NOW project, use matching channels and versioned bounded messages. Wi-Fi association can change the channel; keep callbacks short and queue work for the app loop. A send-status callback does not prove application receipt: use sequence numbers, bounded retries and acknowledgements where needed. A 250-byte payload is the v1 compatibility limit; newer v2 supports more only when both peers and the selected SDK support it. Do not guarantee a one-room range or fixed latency. Broadcast identifiers are not authentication. ESP32-S3 supports BLE, not Bluetooth Classic SPP/A2DP audio.

## Source handling

The owner supplied a vendor-tested guide on November 16, 2026. Its reported configurations and failure observations are supplementary evidence, not new plugin acceptance. Library recommendations still need source/license review and a pinned revision before code is reused. The public manufacturer and driver credits remain in the exact-SKU records; no individual vendor attribution was requested.

Primary references: [CoreS3](https://docs.m5stack.com/en/core/CoreS3), [StickS3](https://docs.m5stack.com/en/core/StickS3), [M145](https://docs.m5stack.com/en/module/Module13.2_QRCode), [RFID2](https://docs.m5stack.com/en/unit/Unit_RFID2), [Gesture](https://docs.m5stack.com/en/unit/Unit_Gesture), [GPS v1.1](https://docs.m5stack.com/en/unit/Unit_GPS_v1.1), [ENV III](https://docs.m5stack.com/en/hat/Hat_ENV-III), [ToF](https://docs.m5stack.com/en/hat/Hat_ToF), and [Espressif ESP-NOW](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/network/esp_now.html). Check the documentation for the app's pinned SDK when implementing radio code.
