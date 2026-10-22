/** App HTTP adapter. Explicit workspace endpoints; no credentials in worker/UI packets. */
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';

export const REQUEST_LIMIT=1024, RESPONSE_LIMIT=8192, NETWORK_DEADLINE=12000;
const name=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,32}$/.test(s);
export function validNetworkState(s){
  if(!s||!['online','offline'].includes(s.link)||!['','host','wifi'].includes(s.source)||
    !Number.isInteger(s.last_id)||s.last_id<0||s.last_id>1e9||!Number.isInteger(s.http_status)||s.http_status<0||s.http_status>599||
    (s.error!==''&&!name(s.error))||!Number.isInteger(s.response_bytes)||s.response_bytes<0||s.response_bytes>RESPONSE_LIMIT)return false;
  const p=s.pending;if(p===null)return true;
  if(!p||!Number.isInteger(p.id)||p.id<1||p.id>1e9||!['connect','disconnect','request'].includes(p.kind))return false;
  if(p.kind!=='request')return p.service===''&&p.method===''&&p.path===''&&p.body_hex==='-';
  return name(p.service)&&['GET','POST'].includes(p.method)&&typeof p.path==='string'&&p.path.length<=256&&/^\/(?!\/)[!-~]*$/.test(p.path)&&!/[\\#]/.test(p.path)&&
    typeof p.body_hex==='string'&&(p.body_hex==='-'||/^(?:[0-9a-f]{2}){1,1024}$/.test(p.body_hex))&&(p.method!=='GET'||p.body_hex==='-');
}
async function containedFile(root,relative,limit,privateFile=false){
  const file=path.resolve(root,relative),actual=await fs.realpath(file),rel=path.relative(root,actual),st=await fs.stat(actual);
  if(rel.startsWith('..')||path.isAbsolute(rel)||!st.isFile()||st.size>limit||(privateFile&&(st.mode&0o077)))throw Error('CONFIG_INVALID');
  return fs.readFile(actual,'utf8');
}
export async function networkConfig(root){
  let data;try{data=JSON.parse(await containedFile(root,'data/network.json',32768));}catch{throw Error('CONFIG_REQUIRED');}
  if(data.version!==1||!data.services||Array.isArray(data.services)||Object.keys(data.services).length<1||Object.keys(data.services).length>4)throw Error('CONFIG_INVALID');
  for(const [key,s]of Object.entries(data.services)){
    if(!name(key)||!s||typeof s.origin!=='string')throw Error('CONFIG_INVALID');
    let u;try{u=new URL(s.origin);}catch{throw Error('CONFIG_INVALID');}
    if(s.origin.length>256||!['http:','https:'].includes(u.protocol)||u.username||u.password||u.pathname!=='/'||u.search||u.hash||
      (u.protocol==='http:'&&s.allowInsecure!==true))throw Error('CONFIG_INVALID');
    if(s.caFile!==undefined&&(typeof s.caFile!=='string'||!/^data\/[A-Za-z0-9_./-]+\.pem$/.test(s.caFile)))throw Error('CONFIG_INVALID');
  }
  return data;
}
export class HostNetwork {
  constructor(root){this.root=root;this.link='offline';}
  async perform(p,signal){
    const done=(error='',status=0,body='')=>({id:p.id,link:this.link,source:'host',error,status,body});
    if(p.kind==='disconnect'){this.link='offline';return done();}
    let config;try{config=await networkConfig(this.root);}catch(e){return done(['CONFIG_REQUIRED','CONFIG_INVALID'].includes(e.message)?e.message:'CONFIG_INVALID');}
    if(config.mode==='offline'){this.link='offline';return done('OFFLINE');}
    if(p.kind==='connect'){this.link='online';return done();}
    if(this.link!=='online')return done('OFFLINE');
    const service=Object.hasOwn(config.services,p.service)?config.services[p.service]:null;if(!service)return done('SERVICE_NOT_ALLOWED');
    let target;try{target=new URL(p.path,service.origin);if(target.origin!==new URL(service.origin).origin)throw Error();}catch{return done('INVALID_PATH');}
    const headers={'accept':'application/json, text/plain','accept-encoding':'identity','connection':'close'};
    let ca;
    try{
      if(service.caFile)ca=await containedFile(this.root,service.caFile,65536);
      if(service.bearerToken===true){
        const privateConfig=JSON.parse(await containedFile(this.root,'.local/network-credentials.json',32768,true));
        const token=privateConfig.tokens?.[p.service];
        if(typeof token!=='string'||token.length<1||token.length>1024||token.startsWith('ENTER_')||/[^\x21-\x7e]/.test(token))return done('TOKEN_REQUIRED');
        headers.authorization='Bearer '+token;
      }
    }catch{return done('CONFIG_INVALID');}
    const body=p.body_hex==='-'?Buffer.alloc(0):Buffer.from(p.body_hex,'hex');
    if(p.method==='POST'){headers['content-type']='application/json';headers['content-length']=String(body.length);}
    return new Promise(resolve=>{
      let request,finished=false;const chunks=[];let bytes=0;
      const finish=(error,status=0,result='')=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);request?.destroy();resolve(done(error,status,result));};
      const abort=()=>finish('CANCELLED');
      const timer=setTimeout(()=>finish('TIMEOUT'),NETWORK_DEADLINE);timer.unref?.();
      signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
      try{
        request=(target.protocol==='https:'?https:http).request(target,{method:p.method,headers,ca,rejectUnauthorized:true},response=>{
          const status=response.statusCode??0;
          if(status>=300&&status<400){response.resume();finish('REDIRECT_BLOCKED',status);return;}
          if(Number(response.headers['content-length'])>RESPONSE_LIMIT){finish('RESPONSE_TOO_LARGE',status);return;}
          response.on('data',chunk=>{bytes+=chunk.length;if(bytes>RESPONSE_LIMIT)finish('RESPONSE_TOO_LARGE',status);else chunks.push(chunk);});
          response.on('end',()=>{try{const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));finish('',status,text);}catch{finish('INVALID_UTF8',status);}});
          response.on('error',()=>finish('CONNECTION_FAILED'));
        });
        request.on('error',e=>finish(String(e.code??'').includes('CERT')||String(e.code??'').includes('TLS')||String(e.code??'').includes('SELF_SIGNED')||String(e.code??'').includes('VERIFY')||String(e.code??'').includes('ISSUER')?'TLS_FAILED':'CONNECTION_FAILED'));
        request.end(body);
      }catch{finish('CONNECTION_FAILED');}
    });
  }
}
