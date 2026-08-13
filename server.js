#!/usr/bin/env node
/**
 * Data Agent Oracle — ingest + feed service
 *
 * Receives HMAC-signed events relayed from the GetFreeQuote oracle outbox
 * (/api/oracle/poll), stores them, and serves a queryable feed to third-party
 * agents with per-key usage accounting (the foundation for L402 microtransaction
 * billing).
 *
 * Zero external dependencies — runs on plain Node. Storage is an append-only
 * JSON log (swap for Postgres/Redis when scaling).
 *
 * Env:
 *   ORACLE_INGEST_SECRET   shared secret used to HMAC-verify incoming events
 *                          (must equal GetFreeQuote's ORACLE_SIGNING_SECRET)
 *   ORACLE_AGENT_SECRET    secret agents send as `Bearer` to query /feed
 *   PORT                   listen port (default 8730)
 *   DATA_FILE              event store path (default ./data/oracle.json)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8730);
const HOST = process.env.HOST || '127.0.0.1';
const INGEST_SECRET = process.env.ORACLE_INGEST_SECRET || '';
const AGENT_SECRET = process.env.ORACLE_AGENT_SECRET || '';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'oracle.json');

// ---- store (append-only JSON log with in-memory index) ----
let events = [];
let usage = {}; // agentKeyId -> { requests, lastSeen }

function loadStore() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      events = Array.isArray(raw.events) ? raw.events : [];
      usage = raw.usage || {};
    }
  } catch (e) {
    console.error('store load error:', e.message);
    events = [];
    usage = {};
  }
}
function saveStore() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify({ events, usage }, null, 2));
}

// ---- HMAC verification (matches GetFreeQuote emitOracleEvent signing) ----
function canonical(event) {
  return `${event.event_type}:${event.entity_type}:${event.entity_id}:${event.version || 1}:${JSON.stringify(event.payload || {})}`;
}
function verifySignature(event) {
  if (!INGEST_SECRET) return false;
  const expected = crypto.createHmac('sha256', INGEST_SECRET).update(canonical(event)).digest('hex');
  return event.signature === expected;
}

// ---- http helpers ----
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 10 * 1024 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}
function bearer(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

// ---- routes ----
async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  // GET /health
  if (req.method === 'GET' && p === '/health') {
    return json(res, 200, { ok: true, events: events.length, uptime: process.uptime() });
  }

  // POST /ingest — batch of signed events from the outbox relay
  if (req.method === 'POST' && p === '/ingest') {
    if (bearer(req) !== INGEST_SECRET) return json(res, 401, { error: 'Unauthorized' });
    const body = await readBody(req);
    const batch = Array.isArray(body) ? body : (body.events || []);
    let added = 0;
    const seen = new Set(events.map((e) => e.id));
    for (const ev of batch) {
      if (!ev || !ev.id) continue;
      if (seen.has(ev.id)) continue; // idempotent
      if (!verifySignature(ev)) continue; // drop unsigned/invalid
      events.push(ev);
      seen.add(ev.id);
      added++;
    }
    saveStore();
    return json(res, 200, { ok: true, received: batch.length, added, total: events.length });
  }

  // GET /feed — agent-facing query with usage accounting (L402 billing foundation)
  if (req.method === 'GET' && p === '/feed') {
    const key = bearer(req);
    if (!key || key !== AGENT_SECRET) return json(res, 401, { error: 'Unauthorized' });
    const keyId = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
    usage[keyId] = { requests: (usage[keyId]?.requests || 0) + 1, lastSeen: new Date().toISOString() };
    const type = url.searchParams.get('type'); // e.g. job.created
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
    let out = events.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    if (type) out = out.filter((e) => e.event_type === type);
    saveStore();
    return json(res, 200, { ok: true, count: out.slice(0, limit).length, events: out.slice(0, limit) });
  }

  // GET /events — admin listing (requires ingest secret)
  if (req.method === 'GET' && p === '/events') {
    if (bearer(req) !== INGEST_SECRET) return json(res, 401, { error: 'Unauthorized' });
    const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500);
    return json(res, 200, { ok: true, count: events.length, events: events.slice(-limit).reverse() });
  }

  // GET /usage — per-agent usage (billing)
  if (req.method === 'GET' && p === '/usage') {
    if (bearer(req) !== INGEST_SECRET) return json(res, 401, { error: 'Unauthorized' });
    return json(res, 200, { ok: true, usage });
  }

  return json(res, 404, { error: 'Not found' });
}

// ---- boot ----
loadStore();
const server = http.createServer((req, res) => {
  route(req, res).catch((e) => json(res, 500, { error: e.message }));
});
server.listen(PORT, HOST, () => {
  console.log(`Data Agent Oracle listening on ${HOST}:${PORT}`);
  console.log(`events loaded: ${events.length}`);
  if (!INGEST_SECRET) console.warn('WARN: ORACLE_INGEST_SECRET not set — ingest verification disabled');
});
