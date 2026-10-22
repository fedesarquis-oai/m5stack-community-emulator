// Derive retained dependency licenses from the build, without private tooling.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const build=JSON.parse(await fs.readFile(path.join(root,'server/dist/build-inputs.json'),'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const packages=new Map();
for(const target of ['server','ui','browserHost'])for(const [input,record] of Object.entries(build[target])){
  if(!input.startsWith('node_modules/')||!record.bytesInOutput)continue;
  const relative=input.split('node_modules/').at(-1),parts=relative.split('/');
  const name=parts[0].startsWith('@')?parts.slice(0,2).join('/'):parts[0];
  const directory=path.join(root,input.slice(0,input.length-relative.length),name);
  const key=await fs.realpath(directory);
  const entry=packages.get(key)??{name,directory:key,targets:new Set(),inputs:[]};
  entry.targets.add(target);entry.inputs.push({target,path:input,bytesInOutput:record.bytesInOutput});packages.set(key,entry);
}
const records=[];
for(const item of [...packages.values()].sort((a,b)=>a.name.localeCompare(b.name))){
  const info=JSON.parse(await fs.readFile(path.join(item.directory,'package.json'),'utf8'));
  const destination=path.join(root,'licenses/npm',item.name);await fs.mkdir(destination,{recursive:true});
  const names=(await fs.readdir(item.directory)).filter(name=>/^(LICENSE|COPYING|NOTICE)(\.|$)/i.test(name));
  const notices=[];
  for(const name of names){
    const source=path.join(item.directory,name);if(!(await fs.stat(source)).isFile())continue;
    const bytes=await fs.readFile(source);await fs.writeFile(path.join(destination,name),bytes);
    notices.push({path:path.relative(root,path.join(destination,name)),source:'locked package distribution',sha256:hash(bytes),bytes:bytes.length});
  }
  if(!notices.length&&item.name==='@cfworker/json-schema'&&info.version==='4.1.1'){
    const file=path.join(destination,'LICENSE.md'),bytes=await fs.readFile(file);
    if(hash(bytes)!=='376944252ab78ca6b41aee44ddea8894927ee67891e77e61eb9d59af63e35094')throw Error('Pinned cfworker license mismatch');
    notices.push({path:path.relative(root,file),source:'https://raw.githubusercontent.com/cfworker/cfworker/5409fdc2bd144f68e8b28c61c71fcb16600000a6/LICENSE.md',sha256:hash(bytes),bytes:bytes.length});
  }
  if(!notices.length)throw Error('Missing license: '+item.name);
  records.push({name:item.name,version:info.version,license:info.license,targets:[...item.targets].sort(),notices,inputs:item.inputs});
}
const bundles=[];
for(const name of ['server/dist/index.js','server/dist/application-server.js','server/dist/browser-preview.js','ui/dist/workbench.html','ui/dist/browser-host.js']){
  const bytes=await fs.readFile(path.join(root,name));bundles.push({path:name,bytes:bytes.length,sha256:hash(bytes)});
}
await fs.writeFile(path.join(root,'licenses/bundled-dependencies.json'),JSON.stringify({description:'Retained dependency source derived from esbuild; exact acquisition versions/integrity are locked in pnpm-lock.yaml.',lockfileSha256:hash(await fs.readFile(path.join(root,'pnpm-lock.yaml'))),bundles,packages:records},null,2)+'\n');
let text='# Third-party JavaScript notices\n\nThe server, fixed emulator UI and loopback browser host contain the dependencies below. Exact versions, retained inputs and bundle/license hashes are recorded in `licenses/bundled-dependencies.json`; package integrity is locked in `pnpm-lock.yaml`. Preserve every listed license. Native dependency and app provenance is in [runtime notices](runtime/THIRD_PARTY_NOTICES.md).\n\n| Package | Version | License | Notice |\n|---|---|---|---|\n';
for(const item of records)text+=`| ${item.name} | ${item.version} | ${item.license} | ${item.notices.map(n=>`[${path.basename(n.path)}](${n.path})`).join(', ')} |\n`;
text+='\nThe cfworker 4.1.1 package omitted its license text. The preserved MIT text is from its exact upstream revision, linked in the inventory. Build-only tools are not included in runtime bundles.\n';
await fs.writeFile(path.join(root,'THIRD_PARTY_NOTICES.md'),text);
console.log(`Recorded ${records.length} retained dependencies and ${bundles.length} bundles.`);
