#!/usr/bin/env python3
"""Pinned, local firmware workflow. Never erases a board as a preparation step."""
import argparse, fcntl, hashlib, json, os, platform, re, shutil, signal, subprocess, sys, tarfile, time, urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
CLI_VERSION='1.5.1'
CORE_VERSION='3.3.12'
LIBRARIES={'M5GFX':'0.2.33','M5Unified':'0.2.26'}
PROFILE='cores3se'  # Backward-compatible default; callers can select an exact target.
PROFILES={p['id']:p for p in json.loads((ROOT/'data/device-profiles.json').read_text()) if 'firmware' in p}
def profile_config(profile):
    if profile not in PROFILES:raise ValueError('Physical adapter not implemented for '+profile)
    return PROFILES[profile]['firmware']

def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def save(path,data,private=False):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    if private:path.parent.chmod(0o700)
    with open(path,'w') as f:json.dump(data,f,indent=2);f.write('\n')
    if private:path.chmod(0o600)
def run(command,log,timeout=900,env=None):
    log=Path(log);log.parent.mkdir(parents=True,exist_ok=True)
    with log.open('w') as output:
        process=subprocess.Popen([str(x) for x in command],stdout=output,stderr=subprocess.STDOUT,stdin=subprocess.DEVNULL,start_new_session=True,env=env)
        try:code=process.wait(timeout=timeout)
        except BaseException:
            import signal
            try:os.killpg(process.pid,signal.SIGTERM)
            except ProcessLookupError:pass
            try:process.wait(timeout=3)
            except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()
            raise
    if code:raise RuntimeError('Command failed; inspect local log '+str(log))
    return log.read_text(errors='replace')

def tools_root():
    # A workspace-local configuration can reuse an explicitly prepared toolchain.
    config=ROOT/'.local/hardware-location.json'
    return Path(json.loads(config.read_text())['path']).resolve() if config.exists() else ROOT/'.local/hardware'
def python():return tools_root()/'python/bin/python'
def cli():return tools_root()/'bin/arduino-cli'
def config():return tools_root()/'arduino-cli.yaml'
def arduino(*args):return [cli(),*args,'--config-file',config()]
def configure():
    root=tools_root();root.mkdir(parents=True,exist_ok=True)
    save(config(),{'directories':{'data':str(root/'arduino-data'),'downloads':str(root/'staging'),'user':str(root/'arduino-user')},'build_cache':{'path':str(root/'build-cache')},'board_manager':{'additional_urls':['https://espressif.github.io/arduino-esp32/package_esp32_index.json']}})

def git_environment():
    # MCP hosts may forward PATH without the overrides required by a relocated
    # Git distribution. Recover helpers only beside the Git already selected by
    # PATH; never switch Git installations or discard explicit/company policy.
    env=dict(os.environ)
    for name in ('GIT_DIR','GIT_COMMON_DIR','GIT_WORK_TREE','GIT_INDEX_FILE',
                 'GIT_OBJECT_DIRECTORY','GIT_ALTERNATE_OBJECT_DIRECTORIES',
                 'GIT_PREFIX','GIT_CEILING_DIRECTORIES','GIT_QUARANTINE_PATH',
                 'GIT_NAMESPACE'):
        env.pop(name,None)
    env.update(GIT_TERMINAL_PROMPT='0',GCM_INTERACTIVE='never',GIT_OPTIONAL_LOCKS='0')
    recovery=('Hardware setup needs the selected Git installation and its HTTPS helper. '
              'Restore its approved GIT_EXEC_PATH or repair that Git installation, then retry setup. '
              'No hardware tooling was downloaded by this attempt.')
    executable=shutil.which('git',path=env.get('PATH',os.defpath))
    if not executable:raise RuntimeError(recovery)
    prefix=Path(executable).resolve().parent.parent
    try:
        result=subprocess.run([executable,'--exec-path'],env=env,stdin=subprocess.DEVNULL,
                              stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=10,check=True)
        location=Path(result.stdout.strip())
    except (OSError,subprocess.SubprocessError):raise RuntimeError(recovery) from None
    def has_helper(folder):
        helper=folder/'git-remote-https'
        return folder.is_absolute() and helper.is_file() and os.access(helper,os.X_OK)
    relocated=False
    if not has_helper(location) and 'GIT_EXEC_PATH' not in env:
        adjacent=prefix/'libexec/git-core'
        if has_helper(adjacent):
            location=adjacent;env['GIT_EXEC_PATH']=str(adjacent);relocated=True
    if not has_helper(location):raise RuntimeError(recovery)
    templates=prefix/'share/git-core/templates'
    if relocated and 'GIT_TEMPLATE_DIR' not in env and templates.is_dir():
        # A configured init.templateDir has precedence over a recovered default.
        # Preserve it (and leave ambiguous configuration errors to Git itself).
        try:
            configured=subprocess.run([executable,'config','--get','init.templateDir'],env=env,
                                      stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,
                                      stderr=subprocess.DEVNULL,timeout=10)
            if configured.returncode==1:env['GIT_TEMPLATE_DIR']=str(templates)
        except (OSError,subprocess.SubprocessError):pass
    return env

def native_ctags(git_env=None):
    root=tools_root(); source=root/'ctags-source'
    commit='abc8fca7499f44c725122881cd380a88c37abe0e'
    if (source/'ctags').exists():return
    if git_env is None:git_env=git_environment()
    if not source.exists():
        run(['git','clone','--depth','1','--branch','5.8-arduino11','https://github.com/arduino/ctags.git',source],root/'ctags-clone.log',env=git_env)
    actual=subprocess.check_output(['git','-C',source,'rev-parse','HEAD'],text=True,env=git_env).strip()
    if actual!=commit:raise RuntimeError('Unexpected Arduino ctags source revision')
    # The 2017 helper uses a reserved macro now used by Apple's SDK. Rename only
    # its internal annotation; parsing behavior remains the upstream implementation.
    for p in source.iterdir():
        if p.suffix in ('.c','.h'):p.write_bytes(p.read_bytes().replace(b'__unused__',b'ARDUINO_CTAGS_UNUSED'))
    run(['sh','-c','cd "$1" && ./configure && make -j2','ctags-build',source],root/'ctags-build.log')
    save(root/'ctags-pin.json',{'commit':commit,'patch':'rename reserved __unused__ annotation','binary_sha256':digest(source/'ctags')})

def setup():
    root=tools_root()
    if platform.system()!='Darwin' or platform.machine() not in ('arm64','x86_64'):
        raise RuntimeError('Automatic setup currently supports macOS arm64/x86_64. No installer was run on this platform.')
    # Check this before Arduino/core downloads, which can take several minutes.
    git_env=None if (root/'ctags-source/ctags').is_file() else git_environment()
    configure()
    if not cli().exists():
        arch='ARM64' if platform.machine()=='arm64' else '64bit';name=f'arduino-cli_{CLI_VERSION}_macOS_{arch}.tar.gz'
        base=f'https://github.com/arduino/arduino-cli/releases/download/v{CLI_VERSION}/'
        checks=urllib.request.urlopen(base+CLI_VERSION+'-checksums.txt',timeout=60).read().decode()
        expected=next(line.split()[0] for line in checks.splitlines() if line.endswith(name))
        raw=urllib.request.urlopen(base+name,timeout=120).read()
        if hashlib.sha256(raw).hexdigest()!=expected:raise RuntimeError('Arduino CLI checksum mismatch')
        archive=root/name;archive.write_bytes(raw);cli().parent.mkdir(exist_ok=True)
        with tarfile.open(archive) as tar:cli().write_bytes(tar.extractfile(tar.getmember('arduino-cli')).read())
        cli().chmod(0o755);save(root/'cli-download.json',{'version':CLI_VERSION,'sha256':expected,'url':base+name})
    version=subprocess.check_output(arduino('version','--format','json'),text=True)
    if json.loads(version)['VersionString']!=CLI_VERSION:raise RuntimeError('Unexpected Arduino CLI version')
    if not python().exists():run([sys.executable,'-m','venv',root/'python'],root/'python-setup.log')
    run([python(),'-m','pip','install','--disable-pip-version-check','esptool==4.8.1','pyserial==3.5'],root/'python-install.log')
    run(arduino('core','update-index'),root/'index.log')
    run(arduino('core','install','esp32:esp32@'+CORE_VERSION),root/'core-install.log',1800)
    run(arduino('lib','install',*[k+'@'+v for k,v in LIBRARIES.items()],'--no-deps'),root/'libraries.log')
    native_ctags(git_env)
    save(root/'pins.json',{'arduino_cli':CLI_VERSION,'esp32':CORE_VERSION,'libraries':LIBRARIES,'esptool':'4.8.1','pyserial':'3.5'})
    return {'status':'ready','tools':str(root),'profiles':list(PROFILES)}

def ports():
    if not python().exists():return {'status':'setup_required','ports':[]}
    code="import json;from serial.tools import list_ports;print(json.dumps([dict(port=p.device,vid=p.vid,pid=p.pid,serial=p.serial_number,description=p.description) for p in list_ports.comports() if p.vid is not None]))"
    return {'status':'ok','ports':json.loads(subprocess.check_output([python(),'-c',code],text=True))}

def target(port,serial):
    if not port or not serial:raise ValueError('Exact port and USB serial are required')
    found=[p for p in ports()['ports'] if p['port']==port and (p['serial'] or '').lower()==serial.lower()]
    if len(found)!=1 or found[0]['vid']!=0x303a or found[0]['pid']!=0x1001:raise ValueError('Selected ESP32-S3 USB identity is missing or changed. UiFlow may use a different USB identity: for StickS3, hold the side reset button until the green LED flashes, release it, then run devices and select the bootloader port/serial. No firmware was written.')
    return found[0]
def esp(port,*args):return [python(),'-m','esptool','--chip','esp32s3','--port',port,'--baud','460800',*args]
def check_chip(port,serial,profile=PROFILE):
    target(port,serial)
    try:info=run(esp(port,'flash_id'),ROOT/'logs/hardware-chip.log',30)
    except RuntimeError as error:
        raise RuntimeError('Device did not answer the firmware loader. Reconnect its USB data cable, run devices again, and retry the same verified build. No firmware was written. '+str(error)) from error
    if ('Detected flash size: '+str(profile_config(profile)['flashBytes']//(1024*1024))+'MB') not in info or ('mac: '+serial.lower()) not in info.lower():raise RuntimeError('Chip identity/flash size does not match the selected board')
    security=run(esp(port,'get_security_info'),ROOT/'logs/hardware-security.log',30)
    if 'Secure Boot: Disabled' not in security or 'Flash Encryption: Disabled' not in security:raise RuntimeError('Protected device: stop and use its owner-managed signed firmware workflow')

def backup(port,serial,profile=PROFILE):
    check_chip(port,serial,profile)
    flash_bytes=profile_config(profile)['flashBytes']
    folder=ROOT/'.hardware-backups'/time.strftime('%Y%m%d-%H%M%S');folder.mkdir(parents=True,exist_ok=False);folder.chmod(0o700)
    binary=folder/'flash.bin'
    old=os.umask(0o077)
    try:
        run(esp(port,'--after','no_reset','read_flash','0','ALL',binary),folder/'read.log',900)
        if binary.stat().st_size!=flash_bytes:raise RuntimeError('Incomplete backup; no install permitted')
        run(esp(port,'verify_flash','0',binary),folder/'verify.log',120)
        receipt={'version':1,'profile':profile,'usb_serial':serial.lower(),'bytes':flash_bytes,'sha256':digest(binary),'verified':True,'file':'flash.bin'}
        save(folder/'receipt.json',receipt,True)
    finally:os.umask(old)
    return {'status':'backup_verified','receipt':str(folder/'receipt.json'),'sha256':receipt['sha256'],'private':True}

def source_files():
    files=[]
    for base in (ROOT/'src',ROOT/'hardware'):
        for path in sorted(base.rglob('*')):
            if path.is_symlink():raise ValueError('Firmware source symlinks are unsupported')
            if path.is_file():files.append(path)
    if (ROOT/'firmware.json').exists():files.append(ROOT/'firmware.json')
    files.append(ROOT/'scripts/hardware.py')
    files.extend(sorted(p for p in (ROOT/'data').rglob('*') if p.is_file() and p.suffix in ('.json','.pem')))
    return files

def source_hash(profile=PROFILE):
    profile_config(profile)
    h=hashlib.sha256(profile.encode()+b'\0')
    for p in source_files():h.update(str(p.relative_to(ROOT)).encode()+b'\0'+p.read_bytes()+b'\0')
    return h.hexdigest()
def requirements(profile=PROFILE):
    path=ROOT/'firmware.json'
    if not path.exists():raise ValueError('Declare app requirements in firmware.json before building hardware. See docs/hardware-workflow.md.')
    data=json.loads(path.read_text());features=data.get('requires')
    if data.get('version')!=1 or not isinstance(features,list) or not all(isinstance(x,str) for x in features):raise ValueError('Invalid firmware.json')
    target_config=profile_config(profile)
    unsupported=set(features)-set(target_config['features'])
    if unsupported:raise ValueError('Physical adapters not implemented: '+', '.join(sorted(unsupported)))
    if data.get('audioDuplex',target_config['audioDuplex'])!=target_config['audioDuplex']:raise ValueError('This target uses '+target_config['audioDuplex']+' audio; full duplex is not implemented')
    volume=data.get('speakerVolume',64)
    if type(volume) is not int or not 0<=volume<=255:raise ValueError('speakerVolume must be an integer from 0 to 255')
    return data

def write_network_config(stage,enabled):
    from urllib.parse import urlsplit
    services=[]
    if enabled:
        manifest=ROOT/'data/network.json'
        if not manifest.is_file() or manifest.is_symlink() or manifest.stat().st_size>32768:raise ValueError('Add bounded service endpoints in data/network.json')
        data=json.loads(manifest.read_text())
        if data.get('version')!=1 or not isinstance(data.get('services'),dict) or not 1<=len(data['services'])<=4:raise ValueError('Invalid network services')
        for name,item in data['services'].items():
            if not re.fullmatch('[A-Za-z0-9_-]{1,32}',name):raise ValueError('Invalid service name')
            origin=item.get('origin','');url=urlsplit(origin)
            if url.port is not None and not 1<=url.port<=65535:raise ValueError('Invalid service port')
            if len(origin)>256 or url.scheme not in ('http','https') or not url.hostname or url.username or url.password or url.path not in ('','/') or url.query or url.fragment:raise ValueError('Service origin must be an HTTP(S) origin with no credentials/path')
            if url.scheme=='http' and item.get('allowInsecure') is not True:raise ValueError('Local HTTP requires explicit allowInsecure; use HTTPS for APIs')
            cert=''
            if url.scheme=='https':
                pem=item.get('caFile','');ca=(ROOT/pem).resolve()
                if not pem.startswith('data/') or (ROOT/'data').resolve() not in ca.parents or not ca.is_file() or ca.stat().st_size>65536:raise ValueError('HTTPS firmware services need a bounded public CA PEM under data/')
                cert=ca.read_text()
                if '-----BEGIN CERTIFICATE-----' not in cert:raise ValueError('Invalid public CA PEM')
            services.append('{'+','.join([json.dumps(name),json.dumps('t'+hashlib.sha256(name.encode()).hexdigest()[:14]),json.dumps(origin.rstrip('/')),json.dumps(cert),'true' if item.get('bearerToken') is True else 'false'])+'}')
    content='#pragma once\nstruct NetworkService {const char* id;const char* storageKey;const char* origin;const char* ca;bool bearer;};\n'
    content+='static constexpr unsigned NETWORK_SERVICE_COUNT='+str(len(services))+';\n'
    content+='static const NetworkService NETWORK_SERVICES[]={'+','.join(services or ['{"","","","",false}'])+'};\n'
    (stage/'network_config.hpp').write_text(content)

def build(profile=PROFILE):
    req=requirements(profile);cfg=profile_config(profile);configure()
    if not cli().exists():raise RuntimeError('Run hardware setup before building firmware')
    version=json.loads(subprocess.check_output(arduino('version','--format','json'),text=True))
    if version.get('VersionString')!=CLI_VERSION:raise RuntimeError('Run hardware setup for the pinned Arduino CLI')
    cores=json.loads(subprocess.check_output(arduino('core','list','--format','json'),text=True))
    if not any(p.get('id')=='esp32:esp32' and p.get('installed_version')==CORE_VERSION for p in cores.get('platforms',[])):raise RuntimeError('Run hardware setup for the pinned ESP32 core')
    for name,version in LIBRARIES.items():
        props=tools_root()/'arduino-user/libraries'/name/'library.properties'
        if not props.exists() or '\nversion='+version+'\n' not in '\n'+props.read_text():raise RuntimeError('Run hardware setup for pinned '+name)
    sha=source_hash(profile);folder=ROOT/'.build/firmware'/profile/sha[:16];stage=folder/'device_app';output=folder/'artifacts'
    if (folder/'receipt.json').exists():
        reviewed_build(folder/'receipt.json',profile)
        return {'status':'built','cached':True,'receipt':str(folder/'receipt.json'),'build_id':sha[:16]}
    if folder.exists():
        folder=folder.with_name(folder.name+'-retry-'+str(time.time_ns()));stage=folder/'device_app';output=folder/'artifacts'
    stage.mkdir(parents=True);output.mkdir()
    # Arduino scans the sketch; app headers/assets retain their relative structure.
    shutil.copytree(ROOT/'src',stage/'src',ignore=shutil.ignore_patterns('*.cpp','*.c','*.ino'))
    shutil.copy2(ROOT/'hardware/firmware.cpp',stage/'firmware.cpp')
    (stage/'device_app.ino').write_text('// Reusable plugin firmware adapter\n')
    (stage/'build_identity.hpp').write_text('#define FIRMWARE_BUILD_ID "'+sha[:16]+'"\n#define FIRMWARE_SPEAKER_VOLUME '+str(req.get('speakerVolume',64))+'\n')
    identity=stage/'build_identity.hpp'
    with identity.open('a') as f:
        f.write('#define FIRMWARE_PROFILE '+json.dumps(profile)+'\n')
        f.write('#define FIRMWARE_BOARD m5::board_t::'+cfg['boardEnum']+'\n')
        f.write('#define FIRMWARE_ROTATION '+str(cfg['rotation'])+'\n')
        f.write('#define FIRMWARE_PSRAM_BYTES '+str(cfg['psramBytes'])+'\n')
        f.write('#define FIRMWARE_AUDIO_DUPLEX '+json.dumps(cfg['audioDuplex'])+'\n')
    enabled='network' in req['requires']
    with identity.open('a') as f:f.write('#define FIRMWARE_NETWORK_ENABLED '+str(int(enabled))+'\n')
    write_network_config(stage,enabled)
    for helper in (ROOT/'hardware').glob('*.hpp'):shutil.copy2(helper,stage/helper.name)
    (stage/'user_draw.hpp').write_text('#include "src/user_draw.hpp"\n')
    run(arduino('compile','--fqbn',cfg['fqbn'],'--jobs','2','--build-property','compiler.cpp.extra_flags=-std=gnu++17 -fexceptions','--build-property','runtime.tools.ctags.path='+str(tools_root()/'ctags-source'),'--output-dir',output,stage),folder/'build.log',1200)
    core=tools_root()/'arduino-data/packages/esp32/hardware/esp32'/CORE_VERSION
    shutil.copy2(core/'tools/partitions/boot_app0.bin',output/'boot_app0.bin')
    files=[('device_app.ino.bootloader.bin',0),('device_app.ino.partitions.bin',0x8000),('boot_app0.bin',0xe000),('device_app.ino.bin',0x10000)]
    receipt={'version':1,'profile':profile,'source_sha256':sha,'build_id':sha[:16],'fqbn':cfg['fqbn'],'requirements':req,'toolchain':{'cli':CLI_VERSION,'esp32':CORE_VERSION,'libraries':LIBRARIES},'artifacts':[{'file':name,'offset':offset,'bytes':(output/name).stat().st_size,'sha256':digest(output/name)} for name,offset in files]}
    save(folder/'receipt.json',receipt)
    return {'status':'built','receipt':str(folder/'receipt.json'),'build_id':sha[:16],'log':str(folder/'build.log'),'physical_verified':False}

def reviewed_build(path,profile=PROFILE):
    path=Path(path).resolve();base=(ROOT/'.build/firmware'/profile).resolve()
    if base not in path.parents or path.name!='receipt.json':raise ValueError('Choose a build receipt from this workspace')
    receipt=json.loads(path.read_text())
    if receipt.get('profile')!=profile or receipt.get('source_sha256')!=source_hash(profile) or receipt.get('build_id')!=source_hash(profile)[:16]:raise ValueError('Source changed since firmware build; build the current revision first')
    expected={'device_app.ino.bootloader.bin':0,'device_app.ino.partitions.bin':0x8000,'boot_app0.bin':0xe000,'device_app.ino.bin':0x10000}
    if len(receipt['artifacts'])!=4 or {a['file']:a['offset'] for a in receipt['artifacts']}!=expected:raise ValueError('Unexpected flash layout')
    for a in receipt['artifacts']:
        p=path.parent/'artifacts'/a['file']
        if p.is_symlink() or p.stat().st_size!=a['bytes'] or digest(p)!=a['sha256']:raise ValueError('Firmware artifact changed; rebuild before installing')
    return path,receipt

def reviewed_backup(path,serial,profile=PROFILE):
    path=Path(path).resolve();base=(ROOT/'.hardware-backups').resolve()
    if base not in path.parents or path.name!='receipt.json':raise ValueError('Choose a private backup receipt from this workspace')
    data=json.loads(path.read_text());binary=path.parent/'flash.bin'
    if data.get('usb_serial')!=serial.lower() or data.get('profile')!=profile or not data.get('verified') or binary.is_symlink() or binary.stat().st_size!=profile_config(profile)['flashBytes'] or digest(binary)!=data.get('sha256'):raise ValueError('Backup does not match this board or its recorded hash')
    return binary

def install(port,serial,build_receipt,backup_receipt,profile=PROFILE):
    path,receipt=reviewed_build(build_receipt,profile);reviewed_backup(backup_receipt,serial,profile);check_chip(port,serial,profile)
    args=[]
    for a in receipt['artifacts']:args.extend([hex(a['offset']),path.parent/'artifacts'/a['file']])
    log=path.parent/'install.log';run(esp(port,'--after','no_reset','write_flash','--flash_mode','keep','--flash_size','keep','--flash_freq','keep',*args),log,180)
    run(esp(port,'verify_flash',*args),path.parent/'verify-install.log',120)
    save(ROOT/'.local/hardware-installed.json',{'profile':profile,'build_id':receipt['build_id'],'serial':serial.lower(),'receipt':str(path),'backup':str(Path(backup_receipt).resolve())},True)
    status=monitor(port,serial,5,profile=profile)
    matches=[x for x in status['events'] if x.get('event')=='status' and x.get('build')==receipt['build_id'] and x.get('ready') and x.get('profile')==profile and x.get('error')=='none']
    return {'status':'installed_and_booted' if matches else 'written_and_verified_boot_unconfirmed','build_id':receipt['build_id'],'log':str(log),'events':status['events'],
            'flash_verified':True,'boot_verified':bool(matches),
            **({} if matches else {'message':'Firmware was written and verified, but this build has not reported a successful startup. Briefly press the physical reset button (do not hold it), then run devices and monitor again. Keep the verified backup; do not erase or reinstall merely because startup is unconfirmed.'})}

def restore(port,serial,backup_receipt,profile=PROFILE):
    binary=reviewed_backup(backup_receipt,serial,profile);check_chip(port,serial,profile)
    run(esp(port,'--after','no_reset','write_flash','--flash_mode','keep','--flash_size','keep','--flash_freq','keep','0',binary),binary.parent/'restore.log',900)
    run(esp(port,'verify_flash','0',binary),binary.parent/'verify-restore.log',120)
    return {'status':'restored_and_verified','boot':'manual confirmation required','backup':str(binary.parent/'receipt.json')}

def monitor(port,serial,seconds,command='STATUS',profile=PROFILE):
    target(port,serial)
    if not 1<=seconds<=30:raise ValueError('Monitor duration must be 1–30 seconds')
    if command not in ('STATUS','RESET_APP','NETCHECK') and not re.fullmatch(r'(?:TAP \d{1,3} \d{1,3} \d{1,5}|BUTTON2? \d{1,5})',command):raise ValueError('Unsupported diagnostic command')
    if command.startswith('TAP ') and not PROFILES[profile]['primaryInput']=='touch':raise ValueError('Selected device has no touchscreen')
    if command.startswith('BUTTON ') and not PROFILES[profile]['primaryInput']=='button':raise ValueError('Selected device has no primary button')
    if command.startswith('BUTTON2 ') and not PROFILES[profile].get('secondaryButton'):raise ValueError('Selected device has no secondary button')
    script=ROOT/'hardware/serial_monitor.py'
    data=subprocess.check_output([python(),script,port,str(seconds),command],text=True,timeout=seconds+5)
    events=json.loads(data)
    return {'status':'observed' if events else 'device_not_responding','events':events,
            **({} if events else {'message':'No plugin firmware status received. Reconnect the USB data cable and identify the device again. An unrelated app may not implement this protocol; do not erase or reinstall automatically.'})}

def network_prepare(profile=PROFILE):
    if 'network' not in profile_config(profile)['features']:raise ValueError('Network adapter not implemented for this target')
    import importlib.util
    spec=importlib.util.spec_from_file_location('private_network_setup',ROOT/'hardware/network_configure.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module.prepare(ROOT)

def network_configure(port,serial,profile=PROFILE,forget=False):
    target(port,serial)
    if 'network' not in profile_config(profile)['features']:raise ValueError('Network adapter not implemented for this target')
    installed=json.loads((ROOT/'.local/hardware-installed.json').read_text())
    installed_profile=installed.get('profile')
    if installed_profile is None:installed_profile=json.loads(Path(installed['receipt']).read_text()).get('profile')
    if installed['serial']!=serial.lower() or installed_profile!=profile:raise ValueError('Installed device identity/profile mismatch')
    filename='--forget' if forget else ROOT/'.local/network-credentials.json'
    result=subprocess.check_output([python(),ROOT/'hardware/network_configure.py',port,profile,installed['build_id'],filename],text=True,timeout=25)
    return json.loads(result)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['setup','devices','build','backup','install','restore','monitor','network-prepare','network-configure','network-forget']);p.add_argument('--profile',default=PROFILE,choices=list(PROFILES));p.add_argument('--port');p.add_argument('--serial');p.add_argument('--build-receipt');p.add_argument('--backup-receipt');p.add_argument('--seconds',type=int,default=5);p.add_argument('--command',default='STATUS');args=p.parse_args()
    def interrupted(signum,frame):raise KeyboardInterrupt('Hardware operation interrupted')
    signal.signal(signal.SIGTERM,interrupted)
    # Serialize independent Codex calls, not only calls in one MCP process.
    lock_path=ROOT/'.local/hardware-operation.lock';lock_path.parent.mkdir(parents=True,exist_ok=True)
    lock=lock_path.open('a')
    try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:raise RuntimeError('Another hardware operation is running in this workspace')
    if args.action=='setup':result=setup()
    elif args.action=='devices':result=ports()
    elif args.action=='build':result=build(args.profile)
    elif args.action=='backup':result=backup(args.port,args.serial,args.profile)
    elif args.action=='install':result=install(args.port,args.serial,args.build_receipt,args.backup_receipt,args.profile)
    elif args.action=='restore':result=restore(args.port,args.serial,args.backup_receipt,args.profile)
    elif args.action=='network-prepare':result=network_prepare(args.profile)
    elif args.action=='network-configure':result=network_configure(args.port,args.serial,args.profile)
    elif args.action=='network-forget':result=network_configure(args.port,args.serial,args.profile,forget=True)
    else:result=monitor(args.port,args.serial,args.seconds,args.command,args.profile)
    print(json.dumps(result,indent=2))
if __name__=='__main__':
    try:main()
    except Exception as error:print(json.dumps({'status':'error','message':str(error)}));sys.exit(1)
