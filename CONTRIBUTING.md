# Contributing

Try a small app first, then report a concrete problem or propose a scoped change. Include the exact device/profile and whether the behavior is from the browser, embedded panel or physical board. Read [AGENTS.md](AGENTS.md) when using an agent.

## Repository layout

- `plugins/m5stack-preview/`: installable plugin source, bundled server/UI, skill and runtime template.
- `.agents/plugins/marketplace.json`: local/Git marketplace catalog.
- `docs/`: installation, scope, troubleshooting and agent handoff.
- `scripts/`: local verification and packaging; never installs or publishes.

User apps belong in separate workspaces. Provider samples, credentials, recordings and firmware backups don't belong in the plugin.

## Build the plugin

Use Node 22+ and pnpm 11.25.0. The checked-in bundles make this unnecessary for normal users.

```sh
cd plugins/m5stack-preview
pnpm install --frozen-lockfile --ignore-scripts
node scripts/build.mjs
node scripts/collect-notices.mjs
node --test tests/application-server.test.mjs tests/device-profiles.test.mjs tests/browser-preview.test.mjs tests/launcher.test.mjs
cd ../..
python3 scripts/package.py --prepare
node scripts/smoke.mjs
```

Dependency lifecycle scripts are disabled; esbuild uses the installed platform binary package. If it is unavailable, diagnose the install rather than running an unrelated bootstrap script. Review changes to the lockfile and licenses. Do not put an internal registry, machine-specific path or credential into configuration.

`--prepare` refreshes hashes after reviewed changes. It does not prove correctness. The native workspace helper requires a complete matching manifest. After further edits, regenerate it and run verification again.

## Test the affected behavior

Start with the closest existing test file. This candidate's focused suite covers exact profile lookup, MCP metadata and browser transport. Audio changes additionally need the worklet/lifecycle tests and a real foreground Chrome check. Native contract changes need compiled profile checks. Firmware changes need build validation and the applicable physical acceptance before claiming hardware support.

For a freshly created starter workspace whose five profiles have already been built, run `node scripts/smoke.mjs --workspace /absolute/starter-workspace`. This executes that trusted app source, checks real native input/PCM and rejects audio on Atom. It does not access a microphone, network service or USB device. Use only the unmodified starter for these assertions.

Use `runtime/data/device-profiles.json` for registry changes, regenerate with `node scripts/generate-device-profiles.mjs`, and check all claimed profiles. Don't manufacture physical support from a profile label or browser test. Existing physical acceptance is recorded separately in the support matrix.

For native build/setup recovery, run `python3 -B runtime/tests/build_recovery_test.py` and `python3 -B runtime/tests/setup_recovery_test.py` from the plugin root. They use small owned local fixtures, not USB or microphone access. The build check uses the existing Clang compiler and verifies retry after an interrupted object write and inherited Git routing.

## Package locally

From the repository root:

```sh
python3 scripts/package.py
python3 scripts/package.py --output /absolute/new-release-directory
```

This produces a repository ZIP, a standalone plugin ZIP and SHA-256 checksums. The repository ZIP is easiest for a new user because it contains the marketplace catalog and agent instructions. Test a clean extraction, tools/list and a native app build before sharing. The scanner catches common secret/path mistakes; it is not a security audit.

Do not upload private development history. Publish only the reviewed repository tree. GitHub publication, release creation and social posting are separate user-authorized actions.
