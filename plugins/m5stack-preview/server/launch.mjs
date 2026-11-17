// Portable MCP/browser entrypoint. Uses exactly the Node selected by the host.
import {pathToFileURL} from 'node:url';
import path from 'node:path';

export function launchArguments(args, version=process.versions.node) {
  if (!/^\d+\./.test(version) || Number(version.split('.')[0]) < 22)
    throw new Error('M5Stack Community Emulator needs Node 22+. Update the selected runtime, then restart Codex. No installer or alternative runtime was tried.');
  const browser=args[0]==='--browser';
  if (args.length && !browser) throw new Error('Usage: node server/launch.mjs [--browser --workspace <workspace> --profile <profile> --app custom]');
  const options=browser?args.slice(1):[];
  const seen=new Set();
  for(let i=0;i<options.length;i+=2){
    if(!['--workspace','--profile','--app'].includes(options[i]) || !options[i+1] || seen.has(options[i]))
      throw new Error('Invalid or repeated browser option. Supply each option and value once.');
    seen.add(options[i]);
  }
  return {entry:browser?'browser-preview.js':'index.js',options};
}
if(process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{
    const {entry,options}=launchArguments(process.argv.slice(2));
    // Browser entrypoint consumes argv only when invoked as the main module.
    const url=new URL('./dist/'+entry,import.meta.url);
    if(entry==='browser-preview.js'){
      const {main}=await import(url);
      await main(options);
    }else await import(url);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
