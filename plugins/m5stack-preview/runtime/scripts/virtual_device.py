"""Native LVGL build and source receipt helpers; browser hosting belongs to the plugin."""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import secrets
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / '.build/virtual-device'
WIDTH, HEIGHT = 135, 240
REGISTRY = json.loads((ROOT/'data/device-profiles.json').read_text())
PROFILES = {p['id']:(p['width'],p['height'],p['label']) for p in REGISTRY}
APPS = ('counter','custom')

def metadata_path(profile):
    if not isinstance(profile,str) or profile not in PROFILES: raise ValueError('Unsupported browser profile')
    return BUILD/('build.json' if profile=='stickcplus2' else 'build-'+profile+'.json')

def source_digest(profile='stickcplus2'):
    metadata_path(profile) # Validate before reading any source.
    paths = {'dependencies.lock.json','scripts/virtual_device.py',
             'vendor/M5GFX/src/lgfx/Fonts/glcdfont.h'}
    for path in (ROOT/'src').iterdir():
        if path.is_file() and path.suffix in ('.h','.hpp','.cpp'):
            paths.add(str(path.relative_to(ROOT)))
    for path in (ROOT/'data').rglob('*'):
        if path.is_file() and path.suffix in ('.json','.wav','.pem'): paths.add(str(path.relative_to(ROOT)))
    digest = hashlib.sha256(profile.encode()+b'\0')
    for name in sorted(paths):
        digest.update(name.encode() + b'\0' + (ROOT/name).read_bytes())
    return digest.hexdigest()

def build(workflow, profile='stickcplus2'):
    target = metadata_path(profile)
    width,height,name = PROFILES[profile]
    workflow.verify_dependencies()
    BUILD.mkdir(parents=True, exist_ok=True)
    lvgl = ROOT/'vendor/lvgl'
    tracked = workflow.git_output(lvgl, 'ls-files', '-z', 'src').split('\0')
    sources = [lvgl/path for path in tracked if path.endswith('.c')]
    sources.append(ROOT/'src/virtual_device.cpp')
    flags = ['-O1', '-g0', '-DLV_CONF_INCLUDE_SIMPLE', '-I'+str(ROOT/'src'), '-I'+str(lvgl)]
    shared_headers = [ROOT/'src/lv_conf.h', ROOT/'dependencies.lock.json'] + list((lvgl/'src').rglob('*.h'))
    header_key = hashlib.sha256(b''.join(str(p.relative_to(ROOT)).encode()+b'\0'+p.read_bytes() for p in sorted(shared_headers))).digest()
    app_headers = list((ROOT/'src').glob('*.hpp'))+list((ROOT/'src').glob('*.h'))+[ROOT/'vendor/M5GFX/src/lgfx/Fonts/glcdfont.h']
    app_header_key = hashlib.sha256(b''.join(p.read_bytes() for p in sorted(app_headers))).digest()
    def compile_one(source):
        key = hashlib.sha256((str(source)+repr(flags)).encode()+source.read_bytes()+header_key+
                             (app_header_key if source.suffix=='.cpp' else b'')).hexdigest()[:20]
        obj = BUILD/(key+'.o')
        if not obj.exists():
            compiler = ['clang++', '-std=c++17'] if source.suffix == '.cpp' else ['clang', '-std=c11']
            # A failed or interrupted compiler may leave a partial output.
            # Publish only successful objects so an ordinary retry can recover.
            descriptor, temporary_name = tempfile.mkstemp(prefix=key+'.', suffix='.o.tmp', dir=BUILD)
            os.close(descriptor)
            temporary = Path(temporary_name)
            try:
                workflow.run([*compiler, *flags, '-c', source, '-o', temporary], log='web-'+key+'.log')
                temporary.replace(obj)
            finally:
                temporary.unlink(missing_ok=True)
        return obj
    digest = source_digest(profile)
    print(f'Building native LVGL virtual {name}: {len(sources)} units; at most 2 compiler workers', flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        objects = list(pool.map(compile_one, sources))
    # Link to a new final path, then atomically publish metadata. This avoids
    # replacing a mapped executable and keeps macOS linker signing intact.
    binary = BUILD/('worker-'+digest[:16]+'-'+secrets.token_hex(4))
    workflow.run(['clang++', *objects, '-o', binary], log='web-link.log')
    if source_digest(profile) != digest:
        raise RuntimeError('Source changed during build; rerun web-build')
    metadata = {'build_id': digest[:16], 'source_sha256': digest,
                'binary': binary.name, 'binary_sha256': hashlib.sha256(binary.read_bytes()).hexdigest(),
                'profile': profile, 'width': width, 'height': height, 'apps': list(APPS)}
    temporary_metadata = target.with_name(target.name+'.'+secrets.token_hex(4)+'.tmp')
    temporary_metadata.write_text(json.dumps(metadata, indent=2)+'\n')
    temporary_metadata.replace(target)
    print('Built '+metadata['build_id'], flush=True)
    return metadata
