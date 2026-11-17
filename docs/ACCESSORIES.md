# Accessory reference library

Codex can look up these parts by exact SKU or listed name through the plugin's existing device-guide tool. Each record includes manufacturer links, wiring notes, library references, a first hardware check and common failures. This library is useful for any project; it does not make the parts mandatory or change the emulator UI.

Start with the packaged [accessory builder guide](../plugins/m5stack-preview/skills/m5stack-preview/references/accessory-bringup.md). It covers both controllers and all six add-ons, example connection plans, the vendor's bench findings and one first test per part. The facts are available to Codex through the exact-SKU records; builders do not need to copy a second AGENTS.md or adopt another toolchain.

**All six are documented, not emulated. Their packaged firmware adapters and physical acceptance are still pending.** A board's working microphone or screen does not prove support for its attached accessories.

| Part | What the app receives | Connection | First useful check |
|---|---|---|---|
| [Module13.2 QRCode M145](https://docs.m5stack.com/en/module/Module13.2_QRCode) | Decoded barcode text | Core stack; UART or USB, plus I2C control | Trigger a scan and display its decoded result |
| [RFID2 U031-B](https://docs.m5stack.com/en/unit/Unit_RFID2) | Tag UID and supported card data | Grove I2C, 0x28 | Read a test UID; do not write the tag |
| [Gesture U127](https://docs.m5stack.com/en/unit/Unit_Gesture) | Nine named gestures | Grove I2C, 0x73 | Show left/right/wave before assigning actions |
| [GPS v1.1 U032-V11](https://docs.m5stack.com/en/unit/Unit_GPS_v1.1) | Position/time and fix validity | Grove UART, 115200 8N1 | Receive sentences, then obtain a fresh outdoor fix |
| [ENV-III HAT U053-D](https://docs.m5stack.com/en/hat/Hat_ENV-III) | Temperature, humidity, pressure | 3.3V HAT I2C; SHT30 and QMP6988 | Read all values with units and validity |
| [ToF HAT U072](https://docs.m5stack.com/en/hat/Hat_ToF) | Distance and measurement status | 3.3V HAT I2C, 0x29 | Move a target; check timeout/out-of-range handling |

Ask Codex:

> I want to build [my idea] with [exact board] and [accessory SKU]. Look up the parts in the plugin, explain what is implemented and what needs a driver, and propose the smallest first check. Keep the emulator unchanged and any fixtures clearly labeled.

The JSON references are in [the accessory catalog](../plugins/m5stack-preview/knowledge/accessories/index.json). The [agent workflow](../plugins/m5stack-preview/skills/m5stack-preview/references/accessories.md) explains bus conflicts, power, dependency selection and fixtures. A successful I2C scan confirms an address answered; it does not prove that measurements or every driver feature work.

## Host and attachment differences

CoreS3 K128 with DinBase is distinct from CoreS3 SE K128-SE. DinBase supplies mounting/power/battery functionality in the K128 kit; it is not a sensor and its electrical behavior is not simulated. Attaching the M145 stack still needs a physical fit, switch and pin check. Standard CoreS3 has a compiled firmware target; physical acceptance remains pending, including accessory fit and operation.

StickS3 K150 has a different expansion map from StickC/Plus2. M5Stack's legacy HAT examples are useful driver references, but their GPIO0/26 assignments must not be copied into a StickS3 build. The vendor reports SDA8/SCL0 at 100 kHz for these HATs; this is now available as a qualified candidate connection, with actual seating/orientation and plugin physical acceptance still pending. StickS3 peripheral power and Grove-versus-HAT bus selection also need attention. Sources: [CoreS3 manual](https://docs.m5stack.com/en/core/CoreS3), [StickS3 manual](https://docs.m5stack.com/en/core/StickS3).

Identify the connector itself: the CoreS3 body's red PORT.A and the M145 module's red PORT.A use different buses. The scanner's RX18/TX17 route also occupies CoreS3 PORT.C. The builder guide explains these conflicts and preserves the vendor's switch settings as reported evidence.

For app logic, a builder can request labeled synthetic sensor events in their own workspace. That can exercise layout, thresholds, state transitions and errors while waiting for hardware. It does not validate wiring, a vendor library or physical deployment. A reusable emulator adapter remains a separate extension.

Reviewed November 16, 2026, including the owner-supplied vendor bench guide. Vendor observations are supplementary evidence, not plugin acceptance. References credit M5Stack and the linked driver authors. No third-party driver source, photos, full guide or binaries were copied into this package.
