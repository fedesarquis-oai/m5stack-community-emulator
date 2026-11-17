#!/usr/bin/env python3
"""Read host readiness; --probe compiles/runs a tiny owned C++ program. No downloads or USB."""
import argparse,json,os,platform,shutil,subprocess,sys,tempfile
from pathlib import Path


def inspect(probe=False):
    report={'system':platform.system(),'architecture':platform.machine(),'python':sys.version.split()[0],
            'tools':{},'issues':[],'compiler_probe':'not_run','hardware_access':False}
    if sys.version_info < (3,9): report['issues'].append('Python 3.9+ required')
    for tool in ['node','git','clang','clang++']:
        executable=shutil.which(tool);report['tools'][tool]=executable
        if not executable:report['issues'].append('Missing '+tool)
    if report['tools']['node']:
        try:
            result=subprocess.run([report['tools']['node'],'--version'],capture_output=True,text=True,timeout=10,check=True)
            if int(result.stdout.strip().lstrip('v').split('.')[0])<22:report['issues'].append('Node 22+ required')
        except (ValueError,OSError,subprocess.SubprocessError):report['issues'].append('Selected Node could not run; repair it before retrying')
    if probe and all(report['tools'][tool] for tool in ['clang','clang++']):
        with tempfile.TemporaryDirectory(prefix='m5 compiler probe ') as directory:
            root=Path(directory);c=root/'part.c';cpp=root/'main.cpp';obj=root/'part.o';binary=root/('probe.exe' if os.name=='nt' else 'probe')
            c.write_text('int value(void){return 42;}\n')
            cpp.write_text('#include <vector>\n#include <iostream>\nextern "C" int value(void);\nint main(){std::vector<int> v{value()};std::cout<<v[0];return v[0]==42?0:1;}\n')
            commands=[[report['tools']['clang'],'-std=c11','-c',str(c),'-o',str(obj)],
                      [report['tools']['clang++'],'-std=c++17',str(cpp),str(obj),'-o',str(binary)], [str(binary)]]
            try:
                for command in commands:subprocess.run(command,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30,check=True)
                report['compiler_probe']='passed'
            except (OSError,subprocess.SubprocessError):
                report['compiler_probe']='failed'
                report['issues'].append('C/C++ compile/link/run failed. Check Clang, system headers and linker. Windows needs Visual Studio C++ Build Tools plus Windows SDK; Linux needs libc/C++ development packages.')
    report['ready']=not report['issues'] and (not probe or report['compiler_probe']=='passed')
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--probe',action='store_true');args=parser.parse_args()
    report=inspect(args.probe);print(json.dumps(report,indent=2));sys.exit(0 if report['ready'] else 1)
