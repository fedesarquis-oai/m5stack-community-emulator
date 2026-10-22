import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes, timingSafeEqual, createHash} from 'node:crypto';

const MAX_BODY = 256 * 1024;
const TOOLS = new Set(['m5stack_frame', 'm5stack_input', 'm5stack_select', 'm5stack_reload', 'm5stack_stop', 'm5stack_audio']);
const failure = message => ({isError: true, content: [{type: 'text', text: message}]});
const hash = value => "'sha256-" + createHash('sha256').update(value).digest('base64') + "'";
function inlineHashes(html, tag) {
  return [...html.matchAll(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>', 'g'))]
    .map(match => hash(match[1])).join(' ');
}
function authorized(value, token) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && timingSafeEqual(Buffer.from(value), Buffer.from(token));
}
async function readJson(request) {
  if (request.headers['content-type'] !== 'application/json' || request.headers['content-encoding']) throw new Error('invalid request');
  if (Number(request.headers['content-length']) > MAX_BODY) throw new Error('request too large');
  let size = 0; const parts = [];
  for await (const part of request) {
    size += part.length;
    if (size > MAX_BODY) throw new Error('request too large');
    parts.push(part);
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}

/** Local, opt-in host for the unchanged MCP App. No network MCP endpoint is exposed.
 * The backend is constructed by trusted CLI code with no voice bindings. The
 * browser can only manipulate the session opened from the CLI's fixed arguments.
 */
export async function startBrowserPreview({backend, uiRoot, openArguments = {}, lifetimeMs = 30 * 60 * 1000} = {}) {
  if (!backend || !uiRoot || !Number.isSafeInteger(lifetimeMs) || lifetimeMs < 1 || lifetimeMs > 30 * 60 * 1000) throw new Error('Invalid browser preview configuration.');
  const token = randomBytes(32).toString('hex');
  const [host, javascript, workbench] = await Promise.all([
    fs.readFile(path.join(uiRoot, 'browser-host.html'), 'utf8'),
    fs.readFile(path.join(uiRoot, 'dist/browser-host.js')),
    fs.readFile(path.join(uiRoot, 'dist/workbench.html'), 'utf8'),
  ]);
  let lastResult, sessionId = null, closed = false, closing, origin, timer, expiresAt, pending = Promise.resolve(), queued=0, audioBusy=false;
  try {
    lastResult = await backend.open(openArguments);
    if (lastResult?.isError) throw new Error('The selected native workspace could not start. Check its prepared build.');
    sessionId = lastResult?.structuredContent?.sessionId ?? null;
  } catch (error) { await backend.close(); throw error; }
  const parentCsp = "default-src 'none'; script-src 'self'; style-src " + inlineHashes(host, 'style') + "; frame-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  // Blob is scoped to this separate browser document for the existing fixed PCM
  // worklet. This does not alter the installed Codex resource's CSP or permissions.
  const appCsp = "default-src 'none'; script-src " + inlineHashes(workbench, 'script') + " blob:; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; worker-src blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
  function respond(response, status, body, type = 'application/json', csp = parentCsp) {
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(status, {'Content-Type': type, 'Content-Security-Policy': csp,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'microphone=(self), camera=(), geolocation=(), autoplay=(self)'});
    response.end(type === 'application/json' ? JSON.stringify(body) : body);
  }
  const server = http.createServer(async (request, response) => {
    try {
      if (closed) return respond(response, 410, {error: 'Preview closed.'});
      if (request.headers.host !== new URL(origin).host || !['127.0.0.1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)) return respond(response, 403, {error: 'Local host required.'});
      const pathname = request.url;
      if (request.method === 'GET' && pathname === '/') return respond(response, 200, host, 'text/html; charset=utf-8');
      if (request.method === 'GET' && pathname === '/browser-host.js') return respond(response, 200, javascript, 'text/javascript; charset=utf-8');
      if (request.method === 'GET' && pathname === '/workbench.html') return respond(response, 200, workbench, 'text/html; charset=utf-8', appCsp);
      if (!authorized(request.headers['x-m5-preview-token'], token)) return respond(response, 403, {error: 'Preview access denied.'});
      if (request.headers.origin && request.headers.origin !== origin) return respond(response, 403, {error: 'Preview origin denied.'});
      if (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin') return respond(response, 403, {error: 'Same-origin request required.'});
      if (request.method === 'GET' && pathname === '/api/bootstrap') {
        // A page refresh may arrive while reload/select is replacing the worker.
        // Bootstrap must observe that replacement before publishing its session.
        await pending;
        return respond(response, 200, {result: lastResult, expiresAt});
      }
      if(request.method==='POST'&&pathname==='/api/lifecycle'){
        if(request.headers.origin!==origin)return respond(response,403,{error:'Preview origin required.'});
        const input=await readJson(request);
        if(!input||Object.keys(input).length!==1||input.state!=='hidden')return respond(response,400,{error:'Invalid lifecycle event.'});
        await backend.suspend?.();return respond(response,200,{ok:true});
      }
      if (request.method !== 'POST' || pathname !== '/api/tool') return respond(response, 404, {error: 'Not found.'});
      if (request.headers.origin !== origin) return respond(response, 403, {error: 'Preview origin required.'});
      const value = await readJson(request);
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['name', 'arguments'].includes(key)) || !TOOLS.has(value.name) || !value.arguments || typeof value.arguments !== 'object' || Array.isArray(value.arguments)) return respond(response, 403, failure('This browser preview does not expose that operation.'));
      const execute = async () => {
        if (closed) return failure('Preview closed.');
        if (!sessionId || value.arguments.sessionId !== sessionId) return failure('The preview session is no longer current.');
        const result = await backend.call(value);
        if (value.name!=='m5stack_audio' && !result?.isError && result?.structuredContent) {
          lastResult = result;
          sessionId = result.structuredContent.sessionId ?? sessionId;
          if (value.name === 'm5stack_stop') sessionId = null;
        }
        return result;
      };
      if(value.name==='m5stack_audio'){
        if(audioBusy)return respond(response,429,failure('Only one microphone operation may be outstanding.'));
        audioBusy=true;
        try{return respond(response,200,await execute());}finally{audioBusy=false;}
      }
      if(queued>=8)return respond(response,429,failure('Too many preview operations are queued.'));
      queued++;
      const result = pending.then(execute).finally(()=>{queued--;});
      pending = result.catch(() => {});
      return respond(response, 200, await result);
    } catch { return respond(response, 400, failure('The browser preview request could not be completed.')); }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  const close = () => closing ??= (async () => {
    closed = true; clearTimeout(timer);
    server.closeIdleConnections();
    const stopped = new Promise(resolve => server.close(resolve));
    try { await backend.close(); }
    finally { server.closeAllConnections(); await stopped; }
  })();
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    origin = 'http://127.0.0.1:' + server.address().port;
    expiresAt = Date.now() + lifetimeMs;
    timer = setTimeout(() => { void close().catch(() => {}); }, lifetimeMs);
  } catch (error) { await close(); throw error; }
  return {url: origin + '/#' + token, origin, close, server};
}
