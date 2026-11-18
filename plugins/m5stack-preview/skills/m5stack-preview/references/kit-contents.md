# What's in the M5Stack hackathon box?

This box pairs a square CoreS3 and a narrow StickS3 with six add-ons. The printing on a part or its packet is the quickest way to confirm it. Other M5Stack kits can have different contents.

## The loose pieces

| What you found | What it does | Try this |
|---|---|---|
| Four round peel-and-stick tags | The RFID2 reader recognizes each sticker by its factory ID. Your app can associate one with a player and another with a game piece. | Leave the backing on. With the RFID app running, hold one sticker flat within 2 cm of the RFID2, lift it away, then try another. |
| Small L-shaped wrench | The standard CoreS3 K128 includes a 2.5 mm Allen key for M3 screws. | Keep it with the DinBase for mounting. The CoreS3 can sit on the table for USB testing. |
| Four small screw-mount clips and a rail clip | The four clips provide screw mounting points for the DinBase. The separate clip holds it on a DIN rail, a standard metal mounting rail. | Leave them in the bag for a tabletop build. If a loose piece looks different, compare it with the packing photos or share a photo before attaching it. |

**Can I program a sticker?** Yes, if its tag type supports writing and its user memory is writable. Assigning an action to its ID only changes your app. To carry information *on* the sticker, a compatible writer can store a short text or URL as an NFC record (NDEF). The app runs the action when it reads the tag. The vendor reported reading an NTAG215. Confirm the type and writable state of your sticker before choosing a write routine. The plugin's first RFID check reads IDs. Writing and reading back a saved value on this kit still needs a physical test. [M5Stack RFID2 manual](https://docs.m5stack.com/en/unit/Unit_RFID2) · [NXP NTAG21x specifications](https://www.nxp.com/products/NTAG213_215_216)

The four stickers come from the hackathon kit's packing guide. The Allen key and clips appear in the manufacturer's K128 packing list. [M5Stack CoreS3 packing list and photos](https://docs.m5stack.com/en/core/CoreS3)

## Which part do I use?

| If you want to… | Look for | Where it goes and what to try |
|---|---|---|
| Build a touch interface | CoreS3 + DinBase, K128 | This is the square controller. Tap its built-in screen. The base supplies a battery and mounting points. The kit uses standard CoreS3. [CoreS3](https://docs.m5stack.com/en/core/CoreS3) |
| Build a handheld button app | StickS3, K150 | This is the narrow controller. Try its front KEY1 and side KEY2. USB-C connects it to the computer. [StickS3](https://docs.m5stack.com/en/core/StickS3) |
| Read a printed QR code or barcode | QR Scanner 13.2, M145 | Stack the module under CoreS3. Aim it at a known code and display the decoded text. [QR scanner](https://docs.m5stack.com/en/module/Module13.2_QRCode) |
| Recognize a sticker by tapping it | RFID2 Unit, U031-B | Use the Grove cable on the CoreS3 body's red PORT.A or the StickS3 Grove port. Read one tag at a time. [RFID2](https://docs.m5stack.com/en/unit/Unit_RFID2) |
| React to a wave or swipe in the air | Gesture Unit, U127 | Use the same Grove I2C connection as RFID2. Pass a hand across the sensor and show the direction it reports. [Gesture](https://docs.m5stack.com/en/unit/Unit_Gesture) |
| Show an outdoor location | GPS/BDS Unit v1.1, U032-V11 | Use the StickS3 Grove port or CoreS3 blue PORT.C with the DinBase attached. Check that data is arriving, then take it outdoors for a position fix. [GPS](https://docs.m5stack.com/en/unit/Unit_GPS_v1.1) |
| Measure temperature, humidity or air pressure | ENV III HAT, U053-D | Fit it on top of the StickS3. Display each reading with its unit. [ENV III](https://docs.m5stack.com/en/hat/Hat_ENV-III) |
| Measure how far away something is | ToF Distance HAT, U072 | Fit it on top of the StickS3. Move a flat target and watch the distance in millimetres. [ToF](https://docs.m5stack.com/en/hat/Hat_ToF) |

## Getting started

Use a USB-C **data** cable to program either board. For a first sensor build, pick one controller and one add-on. Power down before stacking modules or swapping HATs. The Stick has one direct HAT socket. The QR scanner and GPS can compete for the Core's serial pins, so a practical pairing is QR on Core and GPS on Stick.

A builder can try the boards' supported controls in Chrome. For the six add-ons, app-owned sample readings can exercise the display and app logic. Checking an actual tag, scan, gesture, measurement or satellite fix requires the physical part and its driver. For wiring, combinations, library choices, troubleshooting or networking, use the exact SKU in the table and the [accessory builder guide](accessory-bringup.md).
