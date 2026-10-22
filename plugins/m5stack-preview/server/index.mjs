import {createM5StackServer} from './application-server.mjs';
// No implicit app adapter, credential setup or direct provider fallback.
await createM5StackServer().start();
