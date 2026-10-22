import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

// Refuse to ship diverging browser/native device definitions.
import {generateDeviceProfiles} from './generate-device-profiles.mjs';
await generateDeviceProfiles({check:true});
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// A build-only dependency root can reuse already prepared, approved tooling.
// No install, download, package lifecycle, runtime loader override, or PATH edit.
const args=process.argv.slice(2);
if(args.length && (args.length!==2 || args[0]!=='--modules'))throw new Error('Usage: node scripts/build.mjs [--modules /absolute/node_modules]');
const modules=args.length?await fs.realpath(args[1]):null;
const require=createRequire(import.meta.url);
const esbuildEntry=require.resolve('esbuild',modules?{paths:[modules]}:undefined);
const esbuildPackage=JSON.parse(await fs.readFile(path.resolve(path.dirname(esbuildEntry),'../package.json'),'utf8'));
if(esbuildPackage.name!=='esbuild' || esbuildPackage.version!=='0.25.12')throw new Error('Build requires the reviewed esbuild 0.25.12 release.');
const {build}=await import(pathToFileURL(esbuildEntry).href);
// Keep embedded source labels and metadata stable when an agent invokes this
// script from another directory, including the community repository root.
const common={absWorkingDir:root,bundle:true,metafile:true,nodePaths:modules?[modules]:[],legalComments:'linked'};
await fs.mkdir(path.join(root,'server/dist'),{recursive:true});
await fs.mkdir(path.join(root,'ui/dist'),{recursive:true});
const server=await build({...common,entryPoints:{index:path.join(root,'server/index.mjs'),'application-server':path.join(root,'server/application-server.mjs'),'browser-preview':path.join(root,'server/browser-preview.mjs')},outdir:path.join(root,'server/dist'),platform:'node',format:'esm',target:'node22',
  banner:{js:"import { createRequire as m5createRequire } from 'node:module'; const require = m5createRequire(import.meta.url);"}});
const ui=await build({...common,entryPoints:[path.join(root,'ui/main.mjs')],outfile:path.join(root,'ui/dist/workbench.js'),platform:'browser',format:'esm',target:'es2022',write:false});
const browserHost=await build({...common,entryPoints:[path.join(root,'ui/browser-host.mjs')],outfile:path.join(root,'ui/dist/browser-host.js'),platform:'browser',format:'esm',target:'es2022'});
const javascript=ui.outputFiles.find(file=>file.path.endsWith('.js'))?.text;
const css=ui.outputFiles.find(file=>file.path.endsWith('.css'))?.text??'';
if(!javascript)throw new Error('UI bundle missing.');
const template=await fs.readFile(path.join(root,'ui/index.html'),'utf8');
const entryScript='<script type="module" src="./main.mjs"></script>';
if(template.split(entryScript).length!==2)throw new Error('UI template must have exactly one known entry script.');
// Callback replacements preserve literal $ sequences in bundled SDK source.
const html=template.replace('</head>',()=>'<style>'+css.replaceAll('</style','<\\/style')+'</style></head>')
  .replace(entryScript,()=>'<script type="module">'+javascript.replaceAll('</script','<\\/script')+'</script>');
await fs.writeFile(path.join(root,'ui/dist/workbench.html'),html);
for(const output of ui.outputFiles.filter(file=>file.path.endsWith('.LEGAL.txt')))await fs.writeFile(output.path,output.contents);
function normalizedInputs(inputs,outputs){return Object.fromEntries(Object.entries(inputs).map(([name,value])=>{
  const absolute=path.resolve(root,name);
  const normalized=modules && absolute.startsWith(modules+path.sep)?'node_modules/'+path.relative(modules,absolute):path.relative(root,absolute);
  const bytesInOutput=Object.values(outputs).reduce((total,output)=>total+(output.inputs?.[name]?.bytesInOutput??0),0);
  return [normalized,{bytes:value.bytes,format:value.format,bytesInOutput}];
}));}
function outputSummary(outputs){return Object.fromEntries(Object.entries(outputs).map(([name,value])=>[path.relative(root,path.resolve(root,name)),{bytes:value.bytes,imports:value.imports}]));}
await fs.writeFile(path.join(root,'server/dist/build-inputs.json'),JSON.stringify({server:normalizedInputs(server.metafile.inputs,server.metafile.outputs),ui:normalizedInputs(ui.metafile.inputs,ui.metafile.outputs),browserHost:normalizedInputs(browserHost.metafile.inputs,browserHost.metafile.outputs),outputs:{server:outputSummary(server.metafile.outputs),ui:outputSummary(ui.metafile.outputs),browserHost:outputSummary(browserHost.metafile.outputs)}},null,2)+'\n');
console.log('Built local MCP server and self-contained App HTML. Host rendering still needs installed-opener validation.');
