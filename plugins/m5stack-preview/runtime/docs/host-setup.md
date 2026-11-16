# Host setup

Use the same native app workspace and Chrome shell on each operating system. The portable launcher is `node <plugin-root>/server/launch.mjs`; no shell, WSL or virtual machine is required. A compatible **Node 22+ must be on the PATH inherited by Codex**. Restart Codex after a normal tool installation changes PATH. Never disable company security or silently switch executables after a denial.

Setup code is implemented for the hosts below. Implementation is not acceptance: see the repository validation record for real runner and browser results. Only macOS Apple Silicon has historical live Chrome audio acceptance.

| Host | Native app prerequisites | Firmware setup |
|---|---|---|
| macOS arm64/x64 | Node 22+, Python 3.9+, Git and Apple Command Line Tools (Clang, headers, linker, Make) | Pinned macOS CLI, ESP32 packages and existing native ctags workaround |
| Windows x64 | Node 22+, Python 3.9+, Git for Windows, LLVM/Clang and Visual Studio C++ Build Tools with Windows SDK | Pinned Windows CLI ZIP and ESP32 packages; native COM ports; no Unix shell |
| Linux x64/ARM64 | Node 22+, Python 3.9+ with venv/pip, Git, Clang and libc/C++ development packages | Pinned Linux CLI and ESP32 packages; USB device permissions may need normal distro configuration |

Windows ARM64 is outside the pinned firmware installer: Arduino CLI 1.5.1 has no native ARM64 Windows archive. Do not silently select an x64 installer or claim an emulated environment was tested. Other distributions, architectures and WSL require separate acceptance.

## Let Codex check the computer

Before registering the plugin, use the selected Python 3 executable to run:

```text
python <plugin-root>/scripts/preflight.py --probe
```

Use `python3` where that is the installed executable. Preflight locates tools, checks Node's version, compiles C and C++ together, links and runs a tiny owned program in a temporary directory. It does not download anything, read credentials or access USB. It catches the common case where Clang exists but SDK headers, standard libraries or the linker are missing.

If a prerequisite is missing, explain it and use the normal user/organization-approved installer. On Windows, LLVM alone is insufficient: include Visual Studio's **Desktop development with C++** tools and Windows SDK. A Developer PowerShell session can supply the selected SDK environment when automatic detection is unavailable; restart Codex from that configured environment. On Debian/Ubuntu, the usual development prerequisites include `clang`, `build-essential`, `python3-venv` and Git; this is distribution guidance, not an automatic root installation.

The legacy `sh server/launch.sh` remains available on macOS/Linux for browser launches and macOS bundled-Node discovery. It does not satisfy the portable MCP manifest's Node-on-PATH prerequisite.

## Build and open

Create a verified workspace using the packaged `scripts/create_workspace.py`, then from that workspace:

```text
python m5preview setup --browser-only
python m5preview web-build --profile cores3
node <plugin-root>/server/launch.mjs --browser --workspace <absolute-workspace> --profile cores3 --app custom
```

The extensionless `m5preview` is Python source. Pass it to Python on Windows; do not double-click it or rely on shebang execution. `./m5preview` remains available on Unix. Keep the launcher running and open its exact loopback URL in Chrome. Capture still requires app demand, device interaction and browser/OS consent; do not grant permissions from code.

Keep workspaces in a short, writable local folder, outside plugin caches and synchronized folders. Paths with spaces are supported. Very long paths, locked antivirus files and restricted network shares can still prevent toolchain operation; report the exact stage and use an approved local workspace, not a security bypass.

## Firmware and private settings

`python m5preview hardware setup --profile cores3` downloads pinned tools into the workspace. It does not enumerate, reset or flash a device. Builds are likewise independent of USB. Linux/Windows use Arduino's supplied ctags; macOS retains the tested compiler workaround. All archives are checked against the release checksum before extracting the named executable.

Device enumeration is read-only. Linux serial access may require the user's normal `dialout`/device-group or udev setup, followed by signing in again. Never run Codex/the plugin as root or make every serial device world-writable. Windows uses the exact enumerated COM port and serial; do not guess COM numbers. A data-capable USB cable and an exact-SKU check are still required.

Private configuration and backups remain outside the package. Windows uses owner/SYSTEM-only ACLs through its built-in PowerShell, without changing execution policy; Unix uses owner-only permissions. If these checks fail, stop and repair the approved workspace permissions. Do not paste passwords or tokens into chat.

## Acceptance before a workshop

On each promised OS: preflight, fresh workspace setup, build and open an edited app, controls during mic capture, speaker output, Stop/reload, permission denial/retry and clean relaunch. A CI native-worker pass cannot hear audio or confirm a browser permission dialog. Firmware additionally needs exact-board backup, boot, display/input/audio/network checks and a restart. Record each result against its host, plugin version and SKU.

Sources: [Arduino CLI installation](https://docs.arduino.cc/arduino-cli/installation/), [pinned CLI release](https://github.com/arduino/arduino-cli/releases/tag/v1.5.1), [Clang's Windows toolchain guidance](https://clang.llvm.org/docs/UsersManual.html#clang-cl), [Visual Studio C++ tools](https://learn.microsoft.com/en-us/cpp/build/vscpp-step-0-installation).

## Existing app workspaces

A plugin update does not overwrite a builder's separate runtime or app files. To move an older workspace to this runtime, first inventory and preserve it, create a new verified workspace, then copy only the reviewed app headers/assets and public service configuration with the user's intended changes. Rebuild native and firmware receipts. Keep private credentials and backups private and preserve their exact device association; do not replace an existing workspace directory or reuse a stale build receipt.
