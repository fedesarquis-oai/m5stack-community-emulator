import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {workspacePath} from './workbench.mjs';

const actions=new Set(['devices','setup','build','backup','install','restore','monitor','network-prepare','network-configure','network-forget']);
const reply=(value,isError=false)=>({...(isError?{isError:true}:{}),content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value});

// Return numeric progress only. Never return log text, flash contents or secrets.
export async function backupProgress(root,startedAt){
  const base=path.join(root,'.hardware-backups');
  try{
    const st=await fs.lstat(base);if(!st.isDirectory()||st.isSymbolicLink())return null;
    const folders=[];
    for(const item of await fs.readdir(base,{withFileTypes:true})){
      if(!item.isDirectory()||!/^\d{8}-\d{6}$/.test(item.name))continue;
      const folder=path.join(base,item.name),stat=await fs.lstat(folder);
      if(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.mtimeMs>=startedAt-2000)folders.push({folder,time:stat.mtimeMs});
    }
    const folder=folders.sort((a,b)=>b.time-a.time)[0]?.folder;if(!folder)return null;
    const verify=await fs.lstat(path.join(folder,'verify.log')).catch(()=>null);
    if(verify?.isFile()&&!verify.isSymbolicLink())return {phase:'verifying-backup'};
    const f=await fs.open(path.join(folder,'read.log'),constants.O_RDONLY|(constants.O_NOFOLLOW??0));
    try{
      const stat=await f.stat();if(!stat.isFile())return null;
      const size=Math.min(4096,stat.size),buffer=Buffer.alloc(size);
      const {bytesRead}=await f.read(buffer,0,size,Math.max(0,stat.size-size));
      const matches=[...buffer.subarray(0,bytesRead).toString().matchAll(/\d+\s*\(\s*(\d{1,3})\s*%\)/g)];
      const percent=Number(matches.at(-1)?.[1]);
      return Number.isInteger(percent)&&percent>=0&&percent<=100?{phase:'reading-backup',percent}:null;
    }finally{await f.close();}
  }catch{return null;}
}

// Finish each tool call before the host RPC deadline. Status never restarts work.
export function createHardwareRunner({resolveWorkspace=workspacePath,spawnProcess=spawn,waitMs=20000,progress=backupProgress}={}){
  const active=new Map(),devices=new Map(),jobs=new Map();let closed=false;
  function prune(){
    for(const [id,job] of jobs)if(job.result&&Date.now()-job.finishedAt>60*60*1000)jobs.delete(id);
    while(jobs.size>=64){const entry=[...jobs].find(([,job])=>job.result);if(!entry)break;jobs.delete(entry[0]);}
  }
  async function snapshot(job){
    if(job.result)return job.result;
    const detail=job.action==='backup'?await progress(job.root,job.startedAt):null;
    if(job.result)return job.result;
    return reply({status:'running',operationId:job.id,action:job.action,profile:job.profile,
      elapsedSeconds:Math.floor((Date.now()-job.startedAt)/1000),...(detail?{progress:detail}:{}),
      next:'Call m5stack_hardware with action status, the same workspace and operationId. Do not repeat the original action or disconnect USB while it is running.'});
  }
  async function hardware(args){
    const root=await resolveWorkspace(args.workspace);
    if(args.action==='status'){
      const job=jobs.get(args.operationId);
      if(!job||job.root!==root)throw new Error('Hardware operation is unknown or expired. Inspect the workspace receipts/logs and connected device before retrying; no operation was started.');
      return snapshot(job);
    }
    if(closed)throw new Error('Hardware service is stopping.');
    if(!actions.has(args.action)||args.operationId!==undefined)throw new Error('Use operationId only with action status.');
    const deviceKey=typeof args.serial==='string'?args.serial.toLowerCase():null;
    const previous=active.get(root)||(deviceKey&&devices.get(deviceKey));
    if(previous)throw new Error('A hardware operation is already running. Check action status with operationId '+previous.id+'; do not start another operation.');
    prune();if(jobs.size>=64)throw new Error('Too many hardware operations are active. Wait for an existing operation.');
    const job={id:randomUUID(),root,action:args.action,profile:args.profile??'cores3se',startedAt:Date.now(),result:null,child:null};
    active.set(root,job);jobs.set(job.id,job);if(deviceKey)devices.set(deviceKey,job);
    const release=()=>{active.delete(root);if(deviceKey)devices.delete(deviceKey);};
    let script;
    try{
      script=path.join(root,'scripts/hardware.py');
      const st=await fs.lstat(script);if(!st.isFile()||st.isSymbolicLink())throw new Error('This workspace needs the current hardware adapter.');
      if(closed)throw new Error('Hardware service is stopping.');
    }catch(error){release();jobs.delete(job.id);throw error;}
    const argv=[script,args.action,'--profile',job.profile];
    for(const [key,flag] of [['port','--port'],['serial','--serial'],['buildReceipt','--build-receipt'],['backupReceipt','--backup-receipt'],['seconds','--seconds'],['command','--command']])if(args[key]!==undefined)argv.push(flag,String(args[key]));
    let finish,timer,out='',failure=null;
    const completed=new Promise(resolve=>{finish=(value,isError=false)=>{
      if(job.result)return;
      clearTimeout(timer);job.finishedAt=Date.now();job.result=reply({...value,operationId:job.id},isError);
      release();resolve(job.result);
    };});
    job.stop=()=>{try{process.kill(-job.child.pid,'SIGTERM');}catch{}};
    try{job.child=spawnProcess('python3',argv,{cwd:root,stdio:['ignore','pipe','pipe'],detached:true});}
    catch{finish({status:'error',message:'Hardware process could not start. Inspect the local tool setup.'},true);return job.result;}
    const child=job.child;
    timer=setTimeout(()=>{failure='Hardware operation timed out. Inspect its local log and device state before retrying.';job.stop();},args.action==='setup'?2400000:args.action==='build'?1500000:1000000);timer.unref();
    child.stdout.on('data',b=>{if(failure)return;out+=b;if(out.length>128000){failure='Hardware response exceeded its bound. Inspect the workspace logs.';job.stop();}});
    child.stderr.resume(); // Never echo secret-bearing stderr.
    child.on('error',()=>finish({status:'error',message:'Hardware process could not start. Inspect the local tool setup.'},true));
    child.on('close',code=>{
      if(failure)return finish({status:'error',message:failure},true);
      let value;try{value=JSON.parse(out);if(!value||Array.isArray(value)||typeof value!=='object')throw new Error();}
      catch{return finish({status:'error',message:'Hardware operation returned no valid result. Inspect the workspace logs and device state before retrying.'},true);}
      finish(value,!!code);
    });
    let waiting;
    try{await Promise.race([completed,new Promise(resolve=>{waiting=setTimeout(resolve,waitMs);})]);}
    finally{clearTimeout(waiting);}
    return snapshot(job);
  }
  async function stopHardware(){closed=true;for(const job of active.values())job.stop?.();}
  return {hardware,stopHardware};
}
const runner=createHardwareRunner();
export const hardware=runner.hardware;
export const stopHardware=runner.stopHardware;
