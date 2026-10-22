import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {HostNetwork,validNetworkState} from '../server/network-adapter.mjs';

test('HTTP bytes, status, bounds, cancellation and private credential boundary',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'m5-network-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'data'));await fs.mkdir(path.join(root,'.local'));
 const requests=[];const server=http.createServer((req,res)=>{const chunks=[];req.on('data',b=>chunks.push(b));req.on('end',()=>{
  requests.push({path:req.url,auth:req.headers.authorization,body:Buffer.concat(chunks).toString()});
  if(req.url==='/slow')return; // Cancel below; this socket is closed by the adapter.
  if(req.url==='/large'){res.end('x'.repeat(8193));return;}
  if(req.url==='/badtext'){res.end(Buffer.from([0xc0,0x80]));return;}
  if(req.url==='/redirect'){res.writeHead(302,{location:'/secret'});res.end();return;}
  res.writeHead(req.url==='/error'?503:200,{'content-type':'application/json'});res.write('{"ok":');res.end('true}');
 });});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const origin='http://127.0.0.1:'+server.address().port;
 await fs.writeFile(path.join(root,'data/network.json'),JSON.stringify({version:1,services:{api:{origin,allowInsecure:true,bearerToken:true}}}));
 const privateFile=path.join(root,'.local/network-credentials.json');await fs.writeFile(privateFile,JSON.stringify({tokens:{api:'test-only-token'}}),{mode:0o600});
 const n=new HostNetwork(root);let id=0;
 const request=(url,body='',signal)=>n.perform({id:++id,kind:'request',service:'api',method:body?'POST':'GET',path:url,body_hex:body?Buffer.from(body).toString('hex'):'-'},signal);
 assert.equal((await request('/')).error,'OFFLINE');await n.perform({id:++id,kind:'connect'});
 assert.equal((await request('/echo','{"value":42}')).body,'{"ok":true}');assert.equal(requests[0].body,'{"value":42}');assert.equal(requests[0].auth,'Bearer test-only-token');
 await fs.writeFile(privateFile,JSON.stringify({tokens:{api:'ENTER_SERVICE_TOKEN'}}));
 assert.equal((await request('/echo')).error,'TOKEN_REQUIRED');assert.equal(requests.length,1);
 await fs.writeFile(privateFile,JSON.stringify({tokens:{api:'test-only-token'}}));
 assert.equal((await request('/error')).status,503);assert.equal((await request('/large')).error,'RESPONSE_TOO_LARGE');assert.equal((await request('/badtext')).error,'INVALID_UTF8');
 assert.equal((await request('/redirect')).error,'REDIRECT_BLOCKED');assert.ok(!requests.some(r=>r.path==='/secret'));
 const control=new AbortController(),pending=request('/slow','',control.signal);control.abort();assert.equal((await pending).error,'CANCELLED');
 const before=requests.length;await fs.chmod(privateFile,0o644);assert.equal((await request('/echo')).error,'CONFIG_INVALID');assert.equal(requests.length,before);
 await fs.writeFile(path.join(root,'data/network.json'),'{"version":1,"services":{"api":{"origin":"invalid"}}}');assert.equal((await request('/')).error,'CONFIG_INVALID');
});
test('worker requests cannot smuggle another destination or exceed the byte bound',()=>{
 const base={link:'online',source:'host',last_id:1,http_status:200,error:'',response_bytes:0,pending:{id:2,kind:'request',service:'api',method:'GET',path:'/data',body_hex:'-'}};
 assert.ok(validNetworkState(base));
 for(const path of ['//elsewhere/','https://elsewhere/','/back\\slash','/space here','/x#fragment'])assert.equal(validNetworkState({...base,pending:{...base.pending,path}}),false);
 assert.equal(validNetworkState({...base,pending:{...base.pending,method:'POST',body_hex:'aa'.repeat(1025)}}),false);
});
