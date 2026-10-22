#!/usr/bin/env python3
"""Prepare a local source handoff. No upload, dependency copy, logs or sessions."""
import argparse
import hashlib
import json
import os
import tempfile
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TREES = {'src':{'.h','.hpp','.c','.cpp'}, 'scripts':{'.py'}, 'tests':{'.py','.js','.cpp','.h','.hpp','.json'},
         'hardware':{'.hpp','.cpp','.py'}, 'data':{'.json','.wav'}, 'docs':{'.md','.json'}}
OMIT = {'package.py','package_plugin.py','plugin_package_test.py'}

def export(output, profile, app):
    files = [ROOT/name for name in ('README.md','THIRD_PARTY_NOTICES.md','dependencies.lock.json','m5preview','.gitignore','app-manifest.json','firmware.json','LICENSE')]
    for tree, suffixes in TREES.items():
        base = ROOT/tree
        if base.is_symlink(): raise ValueError('Source directory must not be a symlink: '+tree)
        for path in base.rglob('*'):
            if path.is_symlink(): raise ValueError('Source symlinks are not supported')
            if path.is_file() and path.suffix in suffixes and path.name not in OMIT and '__pycache__' not in path.parts:
                files.append(path)
    inventory = {}
    snapshot = {}
    for path in sorted(files):
        if path.is_symlink() or not path.is_file(): raise ValueError('Expected a regular source file: '+path.name)
        raw = path.read_bytes();name = path.relative_to(ROOT).as_posix()
        snapshot[name] = (raw,path.stat().st_mode)
        inventory[name] = {'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
    manifest = {'format':1,'profile':profile,'app':app,'files':inventory,
                'instructions':'Read docs/getting-started.md. Install existing prerequisites, run ./m5preview setup --browser-only, then ./m5preview web-build --profile '+profile+'. Ask the installed community plugin to open this workspace in its fixed Chrome shell.',
                'contains_firmware':False,'contains_recording':False,'published':False,
                'scope':'Native local UI source. Review THIRD_PARTY_NOTICES.md before redistribution.'}
    output=output.expanduser().absolute()
    if output.exists(): raise ValueError('Output already exists; choose a new filename')
    if not output.parent.is_dir(): raise ValueError('Output parent must exist')
    handle, temporary_name = tempfile.mkstemp(prefix='.source-handoff-',suffix='.zip',dir=output.parent)
    os.close(handle)
    temporary=Path(temporary_name)
    try:
        with zipfile.ZipFile(temporary,'w',zipfile.ZIP_DEFLATED) as archive:
            for name,(raw,mode) in snapshot.items():
                entry=zipfile.ZipInfo('m5stack-app-source/'+name)
                entry.external_attr=(mode & 0xFFFF)<<16
                entry.compress_type=zipfile.ZIP_DEFLATED
                archive.writestr(entry,raw)
            archive.writestr('m5stack-app-source/SOURCE_HANDOFF.json',json.dumps(manifest,indent=2)+'\n')
        with zipfile.ZipFile(temporary) as archive:
            if archive.testzip() is not None: raise ValueError('Source archive CRC failed')
        # Publish without replacing an existing file, even if one appears during export.
        os.link(temporary,output)
    finally:
        temporary.unlink()
    digest=hashlib.sha256(output.read_bytes()).hexdigest()
    print(json.dumps({'path':str(output),'sha256':digest,'source_files':len(files),'profile':profile,'app':app,'published':False},indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--profile',choices=('atoms3r','stickcplus2','sticks3','cores3','cores3se'),required=True)
    parser.add_argument('--app',choices=('counter','custom'),required=True)
    args=parser.parse_args()
    try: export(args.output,args.profile,args.app)
    except (OSError,ValueError) as error: parser.exit(1,'ERROR: '+str(error)+'\n')
