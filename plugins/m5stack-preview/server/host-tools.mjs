import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';

export function executableCandidates(name,{platform=process.platform,searchPath=process.env.PATH??''}={}) {
  const impl=platform==='win32'?path.win32:path.posix;
  const names=platform==='win32'?[name+'.exe',name]:[name];
  return searchPath.split(platform==='win32'?';':':').map(part=>part.replace(/^"|"$/g,'')).filter(part=>part&&impl.isAbsolute(part))
    .flatMap(part=>names.map(file=>impl.join(part.replace(/^"|"$/g,''),file)));
}
export async function executable(name) {
  for(const value of executableCandidates(name))try{
    await fs.access(value,process.platform==='win32'?0:1);
    if((await fs.stat(value)).isFile())return value;
  }catch{}
  return null;
}
export async function pythonExecutable(){
  return process.platform==='win32' ? await executable('python') || await executable('python3') : await executable('python3') || await executable('python');
}
export function stopOwnedProcess(child,signal='SIGTERM') {
  if(!child?.pid || child.exitCode!==null && child.exitCode!==undefined)return;
  if(process.platform==='win32'){
    const killer=spawn(path.join(process.env.SystemRoot??'C:\\Windows','System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
    killer.on('error',()=>{try{child.kill(signal);}catch{}});
  }else try{process.kill(-child.pid,signal);}catch{}
}
