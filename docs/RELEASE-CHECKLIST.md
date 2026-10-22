# Community release checks

Candidate **0.7.42**, updated October 22, 2026. This is a community preview for **macOS Apple Silicon, Codex and Chrome**, with the limits in the [support matrix](SUPPORT-MATRIX.md). It is not an official directory submission.

Detailed evidence and historical scope: [VALIDATION.md](VALIDATION.md).

## Completed locally

- [x] GitHub-first setup instructions let recipients ask Codex to install directly from the repository URL; cloning is optional.
- [x] MCP and Chrome use one runtime-selection launcher. Nineteen launcher checks cover quoting, mode selection, missing/unsupported runtimes and terminal execution failures. Codex bundle paths have fixture coverage; this Mac has a ChatGPT-hosted runtime.

- [x] Onboarding starts with the user's own app idea, followed by a supported profile and separate workspace. No example app or community-project selection is required.
- [x] Hardware setup's missing Git helper failure reproduced and fixed. Nine setup, fourteen workflow and six hardware-job regressions passed; an actual pinned ctags clone and compilation succeeded under the affected environment.
- [x] Microphone stale-state and immediate-retry races fixed. All 181 focused UI/worklet/controller/native-audio checks passed, including ordered replies, interruption/retry and the synthetic five-minute limit.
- [x] Rebuilt all server/UI bundles and dependency notices. Twenty-four server/browser/launcher regressions passed.
- [x] A fresh separate workspace downloaded both pinned native libraries and compiled for CoreS3 SE.
- [x] Final 0.7.41 Chrome capture accepted 70.9 seconds of real microphone samples while touch remained responsive. Permission denial and explicit retry also passed earlier in the same release pass.
- [x] Clean extracted package launched twice, reported server/catalog 0.7.41, exposed 14 tools and all five exact profile guides, then shut down cleanly.
- [x] The extracted package created a verified workspace and refused to overwrite an edited one; all 67 workspace files remained unchanged.
- [x] Package hashes, bundle/license inventory, source boundaries and documentation links checked. This boundary scan is not a security audit.
- [x] Existing app workspaces preserved. No USB access or writes during this release pass; the default installed plugin was not replaced.
- [x] Community ZIP sharing instructions included. Nothing has been uploaded or publicly published.

## Independent validation and publication

- [ ] A new user on another Mac follows INSTALL.md using their own idea. Keep this pending until someone actually does it.
- [ ] Complete manual Chrome tab-hide, permission revocation during capture and OS-level audio interruption/recovery. Automated cases pass; this browser pass did not establish the hide behavior and further native UI actions were interrupted. See VALIDATION.md for the observed scope.
- [ ] Publisher chooses the GitHub account and authorizes public repository/release creation, if a public link is wanted.
- [ ] Verify the actual public download and instructions before distributing that link.

Current clean-extraction tests do not claim a new Codex host installation. Earlier isolated CLI install, repeat install, upgrade and removal checks remain scoped to 0.7.38. The current CLI exposes no isolated state flag, so this pass preserves the user's default installation.

Do not automatically repeat physical tests. CoreS3 SE has prior user-confirmed ten-second voice-app deployment; Atom's latest Wi-Fi reprovision regression and StickS3 loudness remain documented follow-ups. Windows/Linux, other browsers and in-Codex panel capture remain outside the accepted community-preview scope.
