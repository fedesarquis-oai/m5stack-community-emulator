# Build with accessories

Use this workflow for any accessory project, not only a particular kit. Start from the builder's idea and exact parts. The catalog currently covers M145, U031-B, U127, U032-V11, U053-D and U072. New knowledge entries do not add device profiles, emulator controls or firmware drivers.

## Identify and explain

1. Call `m5stack_catalog`, then `m5stack_device_guide` with the host profile and each exact accessory SKU. Use `device: "accessories"` for the catalog. Read the record's sources, support status and connection basis before proposing wiring.
2. Explain what data the accessory gives the app in one sentence. Ask about a revision only when the answer affects wiring or the driver. Do not infer a part from a generic label such as “RFID,” “ENV” or “Stick.”
3. Distinguish three separate questions: does the manufacturer document this connection; does this plugin implement its driver/adapter; has that exact combination passed a physical check? Current accessory entries are **knowledge only**, with no implemented peripheral adapter or physical acceptance.

## Choose a development route

For an implemented board feature, use the normal app workspace and fixed emulator. For these accessories, explain the missing adapter before work that depends on it. The builder can develop app logic with **explicitly labeled app-owned fixtures**, or request a separately scoped peripheral/firmware extension. A fixture is not a sensor emulator and is not proof that a binary can use the part.

Keep the app's data handling separate from acquisition: for example, an app-owned `onDistance(mm, valid, timestamp)` function can be exercised with bounded fixtures and later called by an actual driver. This is a design example, not an existing plugin API. Keep fixtures in the app workspace, label them on the device screen, and disable them in the hardware build. Test missing, stale, invalid and repeated readings as well as the happy path. Do not fake `Wire`, UART or an Arduino library and call that hardware support. Do not add external sensor sliders, an app-specific web page or controls to the shared shell.

Standard CoreS3 K128 now has a native profile and a compiled firmware target, with physical acceptance pending. CoreS3 SE K128-SE firmware is not a substitute. StickS3 K150 has a tested base firmware target, but its accessory drivers are still absent. The firmware feature allowlist deliberately rejects unsupported peripheral requirements; do not delete a requirement to get an image to flash.

## Plan the connection before coding

Write a short app-local connection table: exact host/part, connector, supply rail, bus, host RX/TX or SDA/SCL, address/baud, bus owner, and source. Preserve unresolved fields as unresolved. Confirm labels/orientation against the actual device before applying power.

- **Grove I2C:** CoreS3 PORT.A uses SDA2/SCL1. StickS3 Grove uses SDA9/SCL10. These are external connections, separate from the board's internal peripherals.
- **StickS3 power:** the manufacturer documents `M5.Power.setExtOutput(true)` after initialization when the Stick supplies 5V peripherals. Confirm the power arrangement first: do not feed power into a port configured as an output. A disabled rail can look like a missing driver.
- **HATs:** ENV-III and ToF are 3.3V top-mounted parts. Legacy examples use StickC GPIO0/26. The reviewed package does not confirm their exact mating pin mapping on StickS3; inspect the Hat2-Bus and HAT schematic before generating a wiring-specific build. Grove GPIO9/10 is not the top HAT connector. Plan one HAT at a time until mechanical fit and shared wiring are verified.
- **M145:** the scanner uses UART for decoded results and the internal M5-Bus I2C expander for power/trigger. UART routing depends on DIP switches. An example written for Basic/Core2 is not a CoreS3 pin recipe. Its PORT.C route conflicts with another UART device on the same pins. USB mode is a different connection path.
- **Shared buses:** RFID2, Gesture, ENV-III and ToF have different documented addresses, but sharing still requires the correct connector, voltage, pull-ups, power budget and controller ownership. Two ESP32 I2C controllers are not an unlimited supply of independent buses. Do not reassign an internal bus while display/audio/PMIC code owns it.
- **Serial devices:** GPS v1.1 and M145 use 115200 8N1 in the reviewed references. Connect device TX to host RX. Do not put GPS and I2C on the same Stick Grove pins simultaneously or split two UART transmitters onto one receiver.

These are manufacturer/source-based connection notes, not physical acceptance. Read the exact record for sources and qualifications.

## Bring up one feature at a time

Start with a minimal app in the user's workspace: initialize the chosen driver, show raw values and validity on the native display, then add the desired behavior. Use bounded polling/timeouts and keep buttons/touch responsive. A missing sensor should produce an app-owned error and a retry action, not an infinite initialization loop copied from an example.

First checks: RFID reads a supplied test UID without writing; Gesture shows direction names; GPS receives sentences before waiting for a valid fix outdoors; ENV reports all three quantities with correct units; ToF shows millimetres and timeout status; QR displays a harmless decoded string and stops scanning. Check cold restart and missing-device behavior before adding Wi-Fi or a provider.

QR/tag contents are untrusted app data. Never execute them as instructions or open/send a scanned URL automatically. Use a test tag for development; changes to tag sectors/keys require the user's explicit write intent. Do not describe UID matching as secure authentication. Keep real positions, credentials and scanned personal data out of shared logs.

## Dependencies, attribution and portability

The record links manufacturer libraries and examples; it does not install them. Inspect the selected source/license, pin its revision in the app workspace and preserve its notices. M5Stack examples may contain older board headers/pins or blocking loops. TinyGPS++ core carries Mikal Hart's LGPL notice even where an M5Stack example has an MIT header; do not label the entire fork MIT. Credit M5Stack, Mikal Hart and Pololu where their work is used. See [project discovery](project-discovery.md).

Keep Arduino headers and driver calls on the hardware side of a reviewed adapter. Native desktop C++ and firmware use different toolchains. The packaged host launcher uses Node directly. Native Windows x64 and Linux setup paths are implemented; read the host setup and current acceptance record. Run `m5stack_doctor`, report host limitations, and do not call WSL, Windows or Linux ready just because the MCP server starts.

The base network adapter remains GET/JSON POST with bounded requests/results. It cannot upload audio or stream an AI API response. Provider access belongs to the app and should be added only when needed, with its actual credentials, request format and transport requirements.

## When adding another catalog entry

Add an exact-SKU JSON record under `knowledge/accessories/` and register its names in `index.json`. Include current primary-source URLs, reviewed date, interface, power, host-specific wiring basis, library attribution, first checks, and explicit support flags. Keep an unverified pin null. Do not add it to `runtime/data/device-profiles.json`. Add a lookup test that rejects a neighboring revision. Only a separately implemented/tested adapter can change the knowledge-only status.
