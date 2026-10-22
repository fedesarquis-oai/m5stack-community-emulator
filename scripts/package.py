#!/usr/bin/env python3
"""Verify/package only this repository's allowlisted source; no install or upload."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import stat
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / 'plugins/m5stack-preview'
EXCLUDED = {'node_modules', '.git', '__pycache__', '.DS_Store', '.release', '.verify',
            'vendor', '.build', '.local', 'logs', 'evidence', '.hardware-backups', '.hardware-tools'}
REPO_ROOTS = ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'CREDITS.md', 'CHANGELOG.md',
              '.gitignore', '.agents', '.github', 'docs', 'scripts', 'plugins']
SECRET_NAMES = {'network-credentials.json', '.env', 'credentials.json'}
PATTERNS = [rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
            rb'sk-proj-[A-Za-z0-9_-]{20,}', rb'gh[pousr]_[A-Za-z0-9]{30,}',
            rb'/Users/(?!<)[A-Za-z0-9_.-]+/', rb'/home/(?!<)[A-Za-z0-9_.-]+/']


def files(root):
    result = []
    for p in sorted(root.rglob('*')):
        relative = p.relative_to(root)
        if any(part in EXCLUDED for part in relative.parts):
            continue
        if p.is_symlink():
            raise ValueError('Symlink in distribution: ' + str(relative))
        if p.is_file():
            result.append(p)
        elif not p.is_dir():
            raise ValueError('Nonregular distribution entry: ' + str(relative))
    return result


def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def manifest():
    info = json.loads((PLUGIN / 'plugin.json').read_text())
    entries = {}
    for p in files(PLUGIN):
        name = p.relative_to(PLUGIN).as_posix()
        if name == 'package-manifest.json':
            continue
        entries[name] = {'bytes': p.stat().st_size, 'mode': stat.S_IMODE(p.stat().st_mode),
                         'sha256': digest(p)}
    return {'schema_version': 1, 'package': info['name'], 'version': info['version'],
            'distribution': 'community repository', 'files': entries}


def verify():
    stored = json.loads((PLUGIN / 'package-manifest.json').read_text())
    if stored != manifest():
        raise ValueError('Package hashes are stale; run python3 scripts/package.py --prepare')
    inventory = json.loads((PLUGIN / 'licenses/bundled-dependencies.json').read_text())
    if digest(PLUGIN / 'pnpm-lock.yaml') != inventory['lockfileSha256']:
        raise ValueError('Dependency lock changed without regenerating notices')
    for item in inventory['bundles'] + [n for p in inventory['packages'] for n in p['notices']]:
        if digest(PLUGIN / item['path']) != item['sha256']:
            raise ValueError('Bundle/license inventory mismatch: ' + item['path'])
    for p in repository_files():
        name = p.relative_to(ROOT).as_posix()
        if p.name in SECRET_NAMES or p.name.startswith('.env.') or p.suffix in {'.bin', '.elf', '.key', '.pem', '.mov', '.mp4'}:
            raise ValueError('Private/generated file in source: ' + name)
        raw = p.read_bytes()
        if any(re.search(pattern, raw) for pattern in PATTERNS):
            raise ValueError('Potential secret or personal path: ' + name)
        if p.suffix == '.md':
            for target in re.findall(r'\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)', raw.decode()):
                if ':' in target or target.startswith('#'):
                    continue
                clean = target.split('#')[0]
                if clean and not (p.parent / clean).exists():
                    raise ValueError('Broken documentation link: ' + name + ' -> ' + target)
    print('PASS: package hashes, bundle/license inventory, source boundary scan and documentation links')


def repository_files():
    selected = []
    for name in REPO_ROOTS + (['LICENSE'] if (ROOT / 'LICENSE').exists() else []):
        p = ROOT / name
        if not p.exists():
            raise ValueError('Missing repository file: ' + name)
        selected.extend(files(p) if p.is_dir() else [p])
    return sorted(selected)


def archive(paths, destination, prefix, relative_to):
    if destination.exists():
        raise ValueError('Archive already exists; choose a new output directory: ' + destination.name)
    with zipfile.ZipFile(destination, 'x', zipfile.ZIP_DEFLATED) as out:
        for p in paths:
            # Fixed timestamp plus preserved Unix modes makes source ZIPs reproducible.
            info = zipfile.ZipInfo(prefix + '/' + p.relative_to(relative_to).as_posix(), (2026, 10, 20, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | stat.S_IMODE(p.stat().st_mode)) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            out.writestr(info, p.read_bytes())
    with zipfile.ZipFile(destination) as check:
        if check.testzip():
            raise ValueError('ZIP integrity check failed')
    return digest(destination) + '  ' + destination.name


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare', action='store_true', help='Refresh hashes after reviewed source/bundle changes')
    parser.add_argument('--output', type=Path, help='New archive output directory')
    args = parser.parse_args()
    if args.prepare:
        (PLUGIN / 'package-manifest.json').write_text(json.dumps(manifest(), indent=2) + '\n')
    verify()
    if args.output:
        version = manifest()['version']
        args.output.mkdir(parents=True, exist_ok=True)
        sums = [archive(repository_files(), args.output / f'm5stack-community-emulator-v{version}.zip', 'm5stack-community-emulator', ROOT),
                archive(files(PLUGIN), args.output / f'm5stack-preview-v{version}.zip', 'm5stack-preview', PLUGIN)]
        (args.output / 'SHA256SUMS').write_text('\n'.join(sums) + '\n')
        print('\n'.join(sums))


if __name__ == '__main__':
    main()
