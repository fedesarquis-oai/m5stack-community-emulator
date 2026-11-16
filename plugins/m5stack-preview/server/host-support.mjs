// Implementation availability and observed end-to-end acceptance are separate.
export function hostSupport(platform,architecture) {
  const native=['darwin','linux','win32'].includes(platform);
  const firmware=(['darwin','linux'].includes(platform)&&['arm64','x64'].includes(architecture)) || (platform==='win32'&&architecture==='x64');
  return {
    portableLauncherImplemented:native,
    browserEndToEndValidated:platform==='darwin'&&architecture==='arm64',
    browserValidationScope:'Historical macOS Apple Silicon + Chrome acceptance; Windows/Linux native builds and live media need their own results',
    posixShellRequired:false,
    nativeWindowsLauncherSupported:true,
    automaticFirmwareSetupSupported:firmware,
    automaticFirmwareSetupScope:'macOS/Linux x64 and ARM64; Windows x64. Pinned CLI archives are checksum-verified; OS acceptance is separate.',
    requiredTools:['Node 22+ on the Codex host PATH','Python 3.9+','Git','Clang/Clang++ with a usable C/C++ standard library and linker'],
    next:platform==='win32'
      ? 'Use native Windows Node/Python/Git/LLVM plus Visual Studio C++ Build Tools and Windows SDK. Run preflight with a compiler probe. No WSL or shell is required; live Chrome and USB acceptance remain pending.'
      : platform==='linux'
        ? 'Install approved Clang, libc/C++ development headers, Git and Python venv support. Run preflight and build. USB permissions may require the distro device group/udev setup; do not run the plugin as root.'
        : 'Run preflight and build an app; tool presence alone is not successful setup. Existing sh launcher remains a compatibility option for macOS browser launch.',
  };
}
