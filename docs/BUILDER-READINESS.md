# Builder readiness review

Review date: November 16, 2026. Candidate: 0.7.44. This is a technical readiness record, not new hardware acceptance. No devices were available for this review. The accessory library is general-purpose; the pictured CoreS3/StickS3 combination is one use case.

| Builder workflow | Implementation | Acceptance still needed |
|---|---|---|
| Exact board/accessory lookup | Five profiles and six sourced accessory records | Inspect actual part/revision before wiring |
| macOS builder setup | Existing native workflow plus portable Node launcher | Independent fresh installation; Intel Mac and remaining live media lifecycle checks |
| Windows x64 / Linux setup | Portable launcher, native compiler preflight, dependency setup, process/lock handling and OS-specific firmware downloads | CI passed on Windows x64 and Ubuntu x64; real Codex/Chrome controls/audio and USB checks remain pending |
| Standard CoreS3 K128 | Separate firmware target compiled successfully; board/PSRAM checks and capability limits | Exact device backup, boot, display/touch/motion/audio/network and restart |
| CoreS3 SE / AtomS3R / StickS3 | Existing targets and scoped earlier physical acceptance | Retain documented per-device follow-ups; do not reclassify compilation as new physical acceptance |
| Accessories | Manufacturer/source-reviewed setup knowledge | Driver integration, emulator contracts if requested and physical acceptance |
| API calls | Existing bounded named GET/JSON POST adapter on five emulator profiles and four firmware targets | Venue 2.4 GHz network and private credentials; service-specific requirements. No audio upload/streaming adapter |

## Before inviting a mixed-computer group

1. Run one fresh installation on each promised OS. Record actual version, compiler/setup outcome, edited app build, Chrome controls/audio and restart behavior. A CI pass or a new chat on the maintainer's Mac is not this check.
2. Complete standard CoreS3 physical acceptance using its new exact target. The software compiles, but boot/input/audio/network and power-cycle checks still require the actual K128. Never use an SE receipt.
3. Bring up one part at a time. Prioritize a simple external I2C unit, then GPS UART, then the scanner stack and HAT mechanical/pin checks. Record exact GPIOs, bus/power arrangement, library revision and successful cold restart in each app project.
4. Prepare an app-local test for each chosen part: raw value/status first, then the intended interaction. Include missing-device and invalid-data behavior. Keep sample apps and fixtures outside the base plugin.
5. Have data-capable USB cables, the correct Grove cables, known compatible test tags, a harmless QR payload, a flat ToF target, and a clear-sky GPS test location. Confirm HAT placement and stack hardware. Photograph connections after successful validation.
6. Verify a usable 2.4 GHz network and an alternate hotspot before the event. Check whether the venue requires a captive portal or enterprise authentication; do not assume the current SSID/password flow supports it. Keep passwords/tokens in private local configuration. Start offline; add APIs only when the idea needs them.
7. Pin one reviewed release for the group, retain the prior release and flash backups, and capture redacted failure reports with OS, version, SKU, stage and exact error. A failed sensor should not lead to blind reflashing or deleting a builder's workspace.

## Review findings addressed in this candidate

- Added discoverable accessory knowledge without adding fake capabilities or more tools.
- Added host-support status to `m5stack_doctor`; discovering a compiler no longer stands alone as the setup story.
- Corrected stale board-guide audio metadata that still described output as muted by default.
- Added a separate standard CoreS3 firmware target and kept StickC Plus2 explicitly emulator-only, with sources for expansion connectors/power.
- Preserved the shared shell and media transports; retained three previously tested targets and added the compiled CoreS3 target.

## Highest-value next implementation work

With the OS CI matrix passed, prioritize independent real-host onboarding and standard CoreS3 physical acceptance before adding six simulated peripherals. Then define one reusable accessory-input contract with validity, timestamps, bounded events and cleanup, implement one end-to-end driver/fixture path, and expand it part by part. Each extension needs its own source, native and physical evidence. Accessory adapters remain proposed future work; host setup and the CoreS3 build target are implemented in 0.7.44.

The [support matrix](SUPPORT-MATRIX.md), [validation record](VALIDATION.md), [accessory library](ACCESSORIES.md) and [release checklist](RELEASE-CHECKLIST.md) remain the source of release claims.
