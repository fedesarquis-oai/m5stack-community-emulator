"""Small OS adapters for owned processes, locks and private workspace files."""
import os
from pathlib import Path
import platform
import signal
import stat
import subprocess


def process_options():
    return {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == 'nt' else {'start_new_session': True}


def stop_process(process, force=False):
    if process.poll() is not None:
        return
    if os.name == 'nt':
        # Only the process tree started by this workflow; never a process name.
        subprocess.run([str(Path(os.environ['SystemRoot'])/'System32/taskkill.exe'),
                        '/PID', str(process.pid), '/T', '/F'],
                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=10, check=False)
    else:
        try: os.killpg(process.pid, signal.SIGKILL if force else signal.SIGTERM)
        except ProcessLookupError: pass


def lock_operation(file):
    if os.name == 'nt':
        import msvcrt
        file.seek(0, os.SEEK_END)
        if file.tell() == 0:
            file.write(b'\0'); file.flush()
        file.seek(0)
        try: msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError: raise BlockingIOError('Workspace operation is locked') from None
    else:
        import fcntl
        fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)


def arduino_asset(version, system=None, machine=None):
    system = system or platform.system()
    machine = (machine or platform.machine()).lower()
    arch = {'amd64':'64bit', 'x86_64':'64bit', 'arm64':'ARM64', 'aarch64':'ARM64'}.get(machine)
    # No native Windows ARM64 release in the pinned Arduino CLI version.
    if system not in ('Darwin','Linux','Windows') or not arch or (system == 'Windows' and arch != '64bit'):
        raise RuntimeError('Firmware setup supports macOS/Linux x64 or ARM64 and Windows x64; this host has no pinned toolchain. No installer was run.')
    label = 'macOS' if system == 'Darwin' else system
    return f'arduino-cli_{version}_{label}_{arch}.' + ('zip' if system == 'Windows' else 'tar.gz')


# Windows chmod does not restrict a DACL. Use the OS ACL API through its bundled
# PowerShell, without an execution-policy override or credential in arguments.
_ACL_SCRIPT = r'''
$ErrorActionPreference = 'Stop'
$p = $env:M5_PRIVATE_PATH
$acl = Get-Acl -LiteralPath $p
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
if ($env:M5_PRIVATE_ACTION -eq 'protect') {
  $acl.SetOwner($sid)
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($rule) }
  $inherit = [System.Security.AccessControl.InheritanceFlags]::None
  if (Test-Path -LiteralPath $p -PathType Container) {
    $inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
  }
  foreach ($identity in @($sid, [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', $inherit, 'None', 'Allow')
    [void]$acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $p -AclObject $acl
  $acl = Get-Acl -LiteralPath $p
}
$owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
if ($owner -ne $sid.Value) { throw 'Private file is not owned by this user' }
$own = $false
foreach ($rule in $acl.Access) {
  $who = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
  if ($rule.AccessControlType -eq 'Allow') {
    if ($who -notin @($sid.Value, 'S-1-5-18')) { throw 'Private file grants another principal access' }
    if ($who -eq $sid.Value) { $own = $true }
  }
}
if (-not $own) { throw 'Private file lacks owner access' }
'''


def windows_private(path, protect=False):
    env = dict(os.environ, M5_PRIVATE_PATH=str(Path(path).resolve()), M5_PRIVATE_ACTION='protect' if protect else 'verify')
    executable = Path(os.environ['SystemRoot'])/'System32/WindowsPowerShell/v1.0/powershell.exe'
    result = subprocess.run([str(executable), '-NoProfile', '-NonInteractive', '-Command', _ACL_SCRIPT],
                            env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, timeout=20)
    if result.returncode:
        raise ValueError('Could not establish owner-only Windows file access. Use an approved local workspace and inspect its ACL; no credentials were returned.')


def protect_private(path):
    path = Path(path)
    if path.is_symlink(): raise ValueError('Private resources must not be symlinks')
    if os.name == 'nt': windows_private(path, protect=True)
    else: path.chmod(0o700 if path.is_dir() else 0o600)


def verify_private(path, file_stat=None):
    path = Path(path)
    st = file_stat or path.lstat()
    if path.is_symlink() or not stat.S_ISREG(st.st_mode):
        raise ValueError('Private configuration must be a regular file')
    if os.name == 'nt': windows_private(path)
    elif st.st_uid != os.getuid() or st.st_mode & 0o077:
        raise ValueError('Private configuration needs owner-only permissions')
