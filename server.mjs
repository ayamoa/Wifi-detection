import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { scanNetwork, getMeta, getNetworkInfo, getHistorySnapshot } from './lib/scanner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT_START = Number(process.env.PORT) || 7373;
const SCAN_INTERVAL_MS = Math.max(15000, Number(process.env.SCAN_INTERVAL_MS) || 45000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt']);
const compressedCache = new Map();

let snapshot = null;
let scanning = false;
let progress = { phase: 'boot', percent: 0, message: 'Starting scanner', found: 0 };
let lastError = null;
let nextScanAt = null;
let scanTimer = null;
let scanCount = 0;
const clients = new Set();
const startedAt = new Date();

function publicState() {
  const activity = getHistorySnapshot(1);
  return {
    meta: {
      ...getMeta(),
      app: 'Wifi Detection',
      version: '1.0.0',
      startedAt: startedAt.toISOString(),
      scanIntervalMs: SCAN_INTERVAL_MS,
    },
    network: snapshot?.network || null,
    devices: snapshot?.devices || [],
    scan: snapshot?.scan || null,
    activity: {
      count: activity.totalEvents,
      latestAt: activity.latestAt,
    },
    scanning,
    progress,
    nextScanAt,
    error: lastError,
    serverTime: new Date().toISOString(),
  };
}

function writeSse(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    clients.delete(res);
  }
}

function broadcast(event, data) {
  for (const res of clients) writeSse(res, event, data);
}

let progressBroadcastAt = 0;
function onProgress(update) {
  progress = { ...progress, ...update };
  const now = Date.now();
  if (now - progressBroadcastAt > 120 || update.percent === 100) {
    progressBroadcastAt = now;
    broadcast('progress', { scanning, progress, found: progress.found });
  }
}

async function runScan(reason = 'auto') {
  if (scanning) return;
  scanning = true;
  lastError = null;
  nextScanAt = null;
  progress = { phase: 'identify', percent: 1, message: 'Locating network interface', found: snapshot?.devices?.length || 0 };
  broadcast('scan', { scanning: true, reason, progress, serverTime: new Date().toISOString() });

  try {
    const result = await scanNetwork(onProgress);
    snapshot = result;
    scanCount++;
    progress = { phase: 'done', percent: 100, message: 'Constellation synchronized', found: result.devices.length };
    scanning = false;
    nextScanAt = new Date(Date.now() + SCAN_INTERVAL_MS).toISOString();
    for (const alert of result.alerts || []) {
      broadcast('alert', { ...alert, serverTime: new Date().toISOString() });
    }
    broadcast('state', publicState());
    console.log(`[scan ${scanCount}] ${result.devices.length} devices in ${(result.scan.durationMs / 1000).toFixed(1)}s · ${result.alerts?.length || 0} alert(s) · next in ${Math.round(SCAN_INTERVAL_MS / 1000)}s`);
  } catch (error) {
    scanning = false;
    lastError = error?.message || String(error);
    progress = { phase: 'error', percent: 0, message: lastError, found: snapshot?.devices?.length || 0 };
    nextScanAt = new Date(Date.now() + SCAN_INTERVAL_MS).toISOString();
    console.error('[scan] failed:', error);
    broadcast('state', publicState());
  } finally {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => runScan('interval'), SCAN_INTERVAL_MS);
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const isVendor = filePath.startsWith(path.join(PUBLIC_DIR, 'vendor') + path.sep);
    const cacheControl = ext === '.html' ? 'no-store' : isVendor ? 'public, max-age=86400' : 'public, max-age=300';
    const baseHeaders = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': cacheControl,
    };
    const acceptsGzip = /\bgzip\b/i.test(req.headers['accept-encoding'] || '');
    if (acceptsGzip && COMPRESSIBLE.has(ext)) {
      const cacheKey = `${filePath}:${stat.mtimeMs}:${stat.size}`;
      const cached = compressedCache.get(cacheKey);
      if (cached) {
        res.writeHead(200, { ...baseHeaders, 'Content-Encoding': 'gzip', 'Content-Length': cached.length, Vary: 'Accept-Encoding' });
        res.end(cached);
        return;
      }
      fs.readFile(filePath, (readError, data) => {
        if (readError) {
          res.writeHead(500).end('Read error');
          return;
        }
        zlib.gzip(data, { level: 6 }, (gzipError, gzipped) => {
          if (gzipError) {
            res.writeHead(200, { ...baseHeaders, 'Content-Length': data.length });
            res.end(data);
            return;
          }
          if (compressedCache.size > 24) compressedCache.clear();
          compressedCache.set(cacheKey, gzipped);
          res.writeHead(200, { ...baseHeaders, 'Content-Encoding': 'gzip', 'Content-Length': gzipped.length, Vary: 'Accept-Encoding' });
          res.end(gzipped);
        });
      });
      return;
    }
    res.writeHead(200, { ...baseHeaders, 'Content-Length': stat.size });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/state' && req.method === 'GET') {
    sendJson(res, 200, publicState());
    return;
  }

  if (url.pathname === '/api/history' && req.method === 'GET') {
    const limit = url.searchParams.get('limit') || 120;
    sendJson(res, 200, { ...getHistorySnapshot(limit), serverTime: new Date().toISOString() });
    return;
  }

  if (url.pathname === '/api/scan' && (req.method === 'POST' || req.method === 'GET')) {
    if (scanning) {
      sendJson(res, 202, { ok: true, scanning: true, progress });
      return;
    }
    sendJson(res, 202, { ok: true, scanning: true, message: 'Scan started' });
    setTimeout(() => runScan('manual'), 30);
    return;
  }

  if (url.pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    clients.add(res);
    writeSse(res, 'state', publicState());
    if (scanning) writeSse(res, 'scan', { scanning: true, progress });
    const heartbeat = setInterval(() => {
      try { res.write(': keepalive\n\n'); } catch { clients.delete(res); }
    }, 20000);
    req.on('close', () => {
      clearInterval(heartbeat);
      clients.delete(res);
    });
    return;
  }

  if (url.pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      scanning,
      devices: snapshot?.devices?.length || 0,
      uptimeSeconds: Math.round(process.uptime()),
      lastScan: snapshot?.network?.scannedAt || null,
    });
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: 'Unknown API endpoint' });
    return;
  }

  serveStatic(req, res);
});

function listen(port, attemptsLeft = 10) {
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.warn(`Port ${port} is busy, trying ${port + 1}…`);
      listen(port + 1, attemptsLeft - 1);
    } else {
      console.error('Server failed to start:', error);
      process.exit(1);
    }
  });
  server.listen(port, '0.0.0.0', async () => {
    const addresses = ['http://127.0.0.1:' + port];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const address of list || []) {
        if (address.family === 'IPv4' && !address.internal) addresses.push(`http://${address.address}:${port}`);
      }
    }
    console.log('');
    console.log('  ╔══════════════════════════════════════════════╗');
    console.log('  ║        W I F I   D E T E C T I O N          ║');
    console.log('  ╚══════════════════════════════════════════════╝');
    console.log('  Local:   ' + addresses[0]);
    if (addresses[1]) console.log('  Network: ' + addresses[1]);
    console.log('  Scanning ' + (await getNetworkInfo().catch(() => ({ subnet: 'local network' }))).subnet);
    console.log('');
    runScan('boot');
  });
}

listen(PORT_START);

function shutdown() {
  console.log('\nShutting down…');
  clearTimeout(scanTimer);
  for (const res of clients) {
    try { res.end(); } catch {}
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
