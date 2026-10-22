#!/usr/bin/env python3
"""Copy the verified bundled runtime into a new writable workspace; never install."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile

PLUGIN_ROOT = Path(__file__).resolve().parents[1]


def verified_runtime():
    runtime = PLUGIN_ROOT / "runtime"
    manifest_path = PLUGIN_ROOT / "package-manifest.json"
    if not runtime.is_dir() or not manifest_path.is_file():
        raise ValueError("Use the complete assembled plugin package, including runtime/ and its verified package-manifest.json.")
    if runtime.is_symlink() or manifest_path.is_symlink():
        raise ValueError("Package resources must not be symlinks")
    manifest = json.loads(manifest_path.read_text())
    expected = {name: entry for name, entry in manifest["files"].items()
                if name.startswith("runtime/")}
    if not expected or "runtime/m5preview" not in expected:
        raise ValueError("The package manifest does not contain the runtime")
    actual = {}
    for path in runtime.rglob("*"):
        if path.is_symlink():
            raise ValueError("Runtime symlinks are not supported")
        if path.is_file():
            actual[path.relative_to(PLUGIN_ROOT).as_posix()] = path
        elif not path.is_dir():
            raise ValueError("Runtime contains a non-regular resource")
    if set(actual) != set(expected):
        raise ValueError("Runtime file list differs from the package manifest")
    for name, path in actual.items():
        raw = path.read_bytes()
        entry = expected[name]
        if len(raw) != entry["bytes"] or hashlib.sha256(raw).hexdigest() != entry["sha256"]:
            raise ValueError("Runtime hash mismatch: " + name)
    return runtime, actual, expected


def create(destination):
    runtime, files, entries = verified_runtime()
    destination = destination.expanduser().absolute()
    if destination.exists() or destination.is_symlink():
        raise ValueError("Destination already exists; choose a new workspace directory")
    if not destination.parent.is_dir():
        raise ValueError("Destination parent must already exist")
    resolved = destination.resolve()
    if resolved == PLUGIN_ROOT or PLUGIN_ROOT in resolved.parents:
        raise ValueError("Choose a workspace outside the plugin package/cache")
    # Create only the requested directory. A temporary sibling keeps partial
    # copies out of the destination; no global state or dependency is written.
    staging = Path(tempfile.mkdtemp(prefix=".m5preview-copy-", dir=destination.parent))
    try:
        for name, source in sorted(files.items()):
            target = staging / source.relative_to(runtime)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            target.chmod(entries[name]["mode"] & 0o777)
        # mkdir refuses a destination created by another process. Copy into the
        # reserved empty directory rather than replace an existing directory.
        destination.mkdir()
        try:
            for path in staging.iterdir():
                shutil.move(str(path), destination / path.name)
        except BaseException:
            # Never delete a possibly concurrently modified destination.
            raise RuntimeError("Workspace copy incomplete; inspect " + str(destination))
    finally:
        shutil.rmtree(staging)
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", type=Path, required=True,
                        help="New directory under an existing authorized workspace")
    args = parser.parse_args()
    result = create(args.destination)
    print("Created verified workspace: " + str(result))
    print("No plugin installation or dependency setup was performed.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, RuntimeError) as error:
        print("ERROR: " + str(error), file=sys.stderr)
        sys.exit(1)
