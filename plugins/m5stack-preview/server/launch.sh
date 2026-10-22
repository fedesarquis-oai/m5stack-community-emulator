#!/bin/sh
# Select one existing runtime. Execution failures are terminal, never retried
# through another executable. No installer, global PATH write or security change.
set -eu
plugin_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
entrypoint=index.js
usage() {
  echo "Usage: launch.sh [--browser [--workspace /prepared/workspace] [--profile profile] [--app custom]]" >&2
}
if [ "$#" -gt 0 ]; then
  case "$1" in
    --browser) entrypoint=browser-preview.js; shift ;;
    *) usage; exit 2 ;;
  esac
fi
# Validate option shapes without rewriting their values or losing quoting.
# The browser entrypoint validates duplicates, profiles and the workspace.
validate_browser_arguments() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --workspace|--profile|--app)
        if [ "$#" -lt 2 ] || [ -z "$2" ]; then usage; return 2; fi
        shift 2
        ;;
      *) usage; return 2 ;;
    esac
  done
}
validate_browser_arguments "$@"
node_command=$(command -v node || true)
if [ -z "$node_command" ]; then
  for candidate in \
    "/Applications/Codex.app/Contents/Resources/cua_node/bin/node" \
    "/Applications/Codex (Nightly).app/Contents/Resources/cua_node/bin/node" \
    "/Applications/Codex (Alpha).app/Contents/Resources/cua_node/bin/node" \
    "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node" \
    "/Applications/ChatGPT (Nightly).app/Contents/Resources/cua_node/bin/node" \
    "/Applications/ChatGPT (Alpha).app/Contents/Resources/cua_node/bin/node"; do
    if [ -f "$candidate" ] && [ -x "$candidate" ]; then
      node_command=$candidate
      break
    fi
  done
fi
if [ -z "$node_command" ]; then
  echo "M5Stack Community Emulator needs an approved Node 22+ runtime. No installer was run." >&2
  exit 1
fi
node_version=$("$node_command" --version)
node_major=${node_version#v}
node_major=${node_major%%.*}
case "$node_major" in
  ''|*[!0-9]*)
    echo "M5Stack Community Emulator could not identify the selected Node runtime. No other runtime was tried." >&2
    exit 1
    ;;
esac
if [ "$node_major" -lt 22 ]; then
  echo "M5Stack Community Emulator needs Node 22 or newer; selected $node_version. Update the selected runtime, then retry. No installer was run." >&2
  exit 1
fi
if [ ! -f "$plugin_dir/server/dist/$entrypoint" ]; then
  echo "M5Stack Community Emulator is an unbuilt source candidate. Complete package validation before installing it." >&2
  exit 1
fi
exec "$node_command" "$plugin_dir/server/dist/$entrypoint" "$@"
