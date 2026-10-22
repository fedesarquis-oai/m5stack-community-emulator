import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createM5StackServer} from './application-server.mjs';
import {PLUGIN_ROOT} from './workbench.mjs';
import {startBrowserPreview} from './browser-preview-server.mjs';

export async function runBrowserPreview(argumentsList = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argumentsList.length; i += 2) {
    const key = {'--workspace': 'workspace', '--profile': 'profile', '--app': 'app'}[argumentsList[i]];
    if (!key || !argumentsList[i + 1] || Object.hasOwn(args, key)) throw new Error('Usage: browser-preview.js [--workspace /prepared/workspace] [--profile cores3se] [--app counter|custom]');
    args[key] = argumentsList[i + 1];
  }
  if (args.workspace && !path.isAbsolute(args.workspace)) throw new Error('Use an absolute prepared workspace path.');
  const instance = createM5StackServer(); // Generic local emulator; no provider integration.
  const client = new Client({name: 'm5stack-local-browser', version: '1.0.0'});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await instance.start({transport: serverTransport, lifecycle: false});
    await client.connect(clientTransport);
    const backend = {
      open: value => client.callTool({name: 'm5stack_open', arguments: value}),
      call: value => client.callTool(value),
      close: async () => { try { await instance.close(); } finally { await client.close(); } },
    };
    return await startBrowserPreview({backend, uiRoot: path.join(PLUGIN_ROOT, 'ui'), openArguments: args});
  } catch (error) { try { await instance.close(); } finally { await client.close(); } throw error; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const preview = await runBrowserPreview();
    console.log('Local browser preview (30 minutes). Open this capability URL in Chrome:');
    console.log(preview.url);
    console.log('Use the device app to request microphone input; Chrome asks for permission. Sound starts with device interaction; mute and volume are in Audio settings. Ctrl-C stops this preview.');
    const stop = () => { void preview.close().catch(() => { process.exitCode = 1; }); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch { console.error('Browser preview did not start. Verify the command, approved Node runtime and prepared workspace build.'); process.exitCode = 1; }
}
