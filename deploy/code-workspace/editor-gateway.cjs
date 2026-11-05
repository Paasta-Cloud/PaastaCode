// HTTPS-only console entry for one personal editor. Code-server stays on loopback.
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const cookieName = '__Host-paasta-editor';
const secretPattern = /^[A-Za-z0-9_-]{43}$/;

async function body(request, limit = 2048) {
  const chunks = []; let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length; if (bytes > limit) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
function cookie(request) {
  return request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
}
const responseHeaders = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Content-Type-Options': 'nosniff' };
function codeServerEnvironment(env,sessionFile,projects) {
  // code-server gives PORT precedence over --bind-addr. Paasta's public port belongs to the gateway.
  return {...env,PORT:'8081',CODE_SERVER_HOST:'127.0.0.1',PAASTA_EDITOR_SESSION_FILE:sessionFile,PAASTA_EDITOR_PROJECTS_ROOT:projects};
}

function createEditorGateway({ consoleOrigin, workspaceId, verify, internalCookie, sessionFile, upstreamPort = 8081, now = Date.now, leasePollMs = 10_000 }) {
  const origin = new URL(consoleOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== consoleOrigin || origin.username || origin.password) throw new Error('Invalid console origin');
  const cache = new Map();
  const sockets = new Set();
  const authorized = async key => {
    if (!secretPattern.test(key || '')) throw new Error('No session');
    const cached = cache.get(key);
    if (cached && cached.until > now()) return cached.grant;
    let grant;
    try { grant = await verify({ action: 'check', workspaceId, sessionKey: key }); }
    catch (error) {
      cache.delete(key);
      try { if (JSON.parse(await fs.readFile(sessionFile, 'utf8')).sessionKey === key) await fs.unlink(sessionFile); } catch { /* A newer, authorized session may own this file. */ }
      throw error;
    }
    const expires = new Date(grant?.expiresAt).getTime();
    if (!grant || grant.sessionKey !== key || grant.workspaceId !== workspaceId || grant.server !== consoleOrigin || !/^paasta_[A-Za-z0-9_-]{43}$/.test(grant.token) || !Number.isFinite(expires) || expires <= now()) throw new Error('Session expired');
    cache.set(key, { until: now() + 10_000, grant });
    if (cache.size > 100) for (const [old, value] of cache) if (value.until < now()) cache.delete(old);
    await fs.mkdir(path.dirname(sessionFile), { recursive: true, mode: 0o700 });
    const temporary = sessionFile + '.' + crypto.randomBytes(8).toString('hex');
    await fs.writeFile(temporary, JSON.stringify(grant), { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, sessionFile);
    return grant;
  };
  const upstreamHeaders = async request => {
    const cookies = (request.headers.cookie || '').split(';').map(value => value.trim()).filter(value => value && !value.startsWith(cookieName + '=') && !value.startsWith('code-server-session='));
    cookies.push(await internalCookie(request.headers.host));
    return { ...request.headers, cookie: cookies.join('; '), 'x-forwarded-proto': 'https' };
  };
  const deny = response => { response.writeHead(303, { ...responseHeaders, Location: consoleOrigin + '/editor?entry=expired' }); response.end(); };
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://local').pathname;
    if (request.method === 'GET' && pathname === '/healthz') {
      const probe = http.get({ hostname: '127.0.0.1', port: upstreamPort, path: '/healthz', timeout: 2000 }, upstream => {
        response.writeHead(upstream.statusCode === 200 ? 200 : 503, responseHeaders); response.end('editor'); upstream.resume();
      });
      probe.on('error', () => { if (!response.headersSent) response.writeHead(503, responseHeaders); response.end(); });
      probe.on('timeout', () => probe.destroy()); return;
    }
    if (pathname === '/_paasta/launch') {
      try {
        const trusted = request.headers.origin === consoleOrigin || consoleOrigin === 'https://console.paasta.cloud' && request.headers.origin === 'https://paasta.cloud';
        if (request.method !== 'POST' || !trusted || !String(request.headers['content-type']).startsWith('application/x-www-form-urlencoded')) throw new Error('Invalid entry');
        const ticket = new URLSearchParams(await body(request)).get('ticket');
        if (!secretPattern.test(ticket || '')) throw new Error('Invalid ticket');
        const grant = await verify({ action: 'redeem', workspaceId, ticket });
        // Revalidate via the ordinary lease path before serving any editor bytes.
        await authorized(grant.sessionKey);
        response.writeHead(303, { ...responseHeaders, Location: '/', 'Set-Cookie': `${cookieName}=${grant.sessionKey}; Path=/; Secure; HttpOnly; SameSite=Lax` });
        response.end();
      } catch { deny(response); }
      return;
    }
    if (pathname === '/login' || pathname.startsWith('/_paasta/')) { deny(response); return; }
    try {
      await authorized(cookie(request));
      if (!['GET', 'HEAD'].includes(request.method) && request.headers.origin !== `https://${request.headers.host}`) throw new Error('Untrusted request origin');
      const proxy = http.request({ hostname: '127.0.0.1', port: upstreamPort, method: request.method, path: request.url, headers: await upstreamHeaders(request) }, upstream => {
        const headers = { ...upstream.headers }; delete headers['set-cookie'];
        response.writeHead(upstream.statusCode, { ...headers, 'Referrer-Policy': 'strict-origin-when-cross-origin' }); upstream.pipe(response);
      });
      proxy.on('error', () => { if (!response.headersSent) response.writeHead(502, responseHeaders); response.end('Editor unavailable'); });
      request.pipe(proxy);
    } catch { request.resume(); deny(response); }
  });
  server.on('upgrade', async (request, socket, head) => {
    try {
      if (request.headers.origin !== `https://${request.headers.host}`) throw new Error('Untrusted websocket origin');
      const key = cookie(request); await authorized(key);
      const proxy = http.request({ hostname: '127.0.0.1', port: upstreamPort, method: 'GET', path: request.url, headers: await upstreamHeaders(request) });
      proxy.on('upgrade', async (upstream, remote, upstreamHead) => {
        // End active editor connections within the bounded lease window after logout/revocation.
        const connection = { key, socket, remote }; sockets.add(connection);
        socket.write(`HTTP/1.1 ${upstream.statusCode} Switching Protocols\r\n` + Object.entries(upstream.headers).filter(([name]) => name !== 'set-cookie').map(([name, value]) => `${name}: ${value}\r\n`).join('') + '\r\n');
        if (upstreamHead.length) socket.write(upstreamHead); if (head.length) remote.write(head);
        socket.pipe(remote); remote.pipe(socket);
        const timer = setInterval(() => authorized(key).catch(() => { socket.destroy(); remote.destroy(); }), leasePollMs); timer.unref();
        const close = () => { clearInterval(timer); sockets.delete(connection); socket.destroy(); remote.destroy(); };
        socket.on('error', close); remote.on('error', close); socket.on('close', close); remote.on('close', close);
      });
      proxy.on('response', upstream => { upstream.resume(); socket.destroy(); });
      proxy.on('error', () => socket.destroy()); proxy.end();
    } catch { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); }
  });
  server.on('close', () => { for (const item of sockets) { item.socket.destroy(); item.remote.destroy(); } });
  return server;
}

async function migrateLegacyFolder(home) {
  const file = path.join(home, '.local/share/code-server/coder.json');
  let temporary;
  try {
    if ((await fs.lstat(file)).isSymbolicLink()) return false;
    const settings = JSON.parse(await fs.readFile(file, 'utf8'));
    if (settings.query?.folder !== path.join(home, 'project') || settings.query.workspace) return false;
    settings.query.folder = path.join(home, 'projects');
    temporary = file + '.paasta-' + crypto.randomBytes(8).toString('hex');
    await fs.writeFile(temporary, JSON.stringify(settings), { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, file);
    return true;
  } catch { return false; }
  finally { if (temporary) await fs.unlink(temporary).catch(() => {}); }
}

async function main() {
  const consoleOrigin = process.env.PAASTA_EDITOR_CONTROL_URL;
  const workspaceId = process.env.PAASTA_EDITOR_WORKSPACE_ID;
  const control = process.env.PAASTA_EDITOR_CONTROL_KEY;
  if (!secretPattern.test(control || '') || !workspaceId || !consoleOrigin || !process.env.PASSWORD) throw new Error('Editor bootstrap configuration is incomplete');
  const sessionFile = path.join(process.env.HOME, '.paasta-online', 'session.json');
  const projects = path.join(process.env.HOME, 'projects'); await fs.mkdir(projects, { recursive: true });
  await migrateLegacyFolder(process.env.HOME);
  // This personal, console-authorized environment is trusted by its owner; desktop trust settings are unchanged.
  const child = spawn('code-server', ['--bind-addr', '127.0.0.1:8081', '--auth', 'password', '--disable-telemetry', '--disable-workspace-trust', '--extensions-dir', path.join(process.env.HOME, '.local/share/code-server/extensions'), projects], { stdio: 'inherit', env: codeServerEnvironment(process.env,sessionFile,projects) });
  const verify = async data => {
    const response = await fetch(consoleOrigin + '/api/editor/runtime', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${control}` }, body: JSON.stringify(data) });
    if (!response.ok) throw new Error('Console lease rejected');
    const text = await response.text(); if (text.length > 16000) throw new Error('Invalid console response'); return JSON.parse(text);
  };
  let loginCookie;
  const internalCookie = async host => {
    if (loginCookie) return loginCookie;
    const response = await fetch('http://127.0.0.1:8081/login', { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(5000), headers: { Host: host, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password: process.env.PASSWORD }) });
    const value = response.headers.get('set-cookie')?.split(';')[0];
    if (![302, 303].includes(response.status) || !/^code-server-session=[^;\s]+$/.test(value || '')) throw new Error('Internal editor login failed');
    loginCookie = value; return value;
  };
  const server = createEditorGateway({ consoleOrigin, workspaceId, verify, internalCookie, sessionFile });
  server.listen(8080, '0.0.0.0');
  child.once('exit', code => { server.close(); process.exit(code || 1); });
  process.once('SIGTERM', () => { server.close(); child.kill('SIGTERM'); });
}
if (require.main === module) main().catch(() => { console.error('Editor gateway startup failed'); process.exitCode = 1; });
module.exports = { createEditorGateway, codeServerEnvironment, migrateLegacyFolder };
