#!/usr/bin/env node
/**
 * Data Agent Oracle — relay worker
 *
 * Drains the GetFreeQuote oracle outbox (/api/oracle/poll) and forwards the
 * signed events to the Data Agent Oracle /ingest endpoint.
 *
 * Usage:
 *   node relay.js            # one pass (good for cron: every minute)
 *   node relay.js --loop N   # daemon: repeat every N seconds
 *
 * Env:
 *   POLL_URL       GetFreeQuote outbox, e.g. https://getfreequote.org/api/oracle/poll
 *   POLL_SECRET    = GetFreeQuote ORACLE_POLL_SECRET (Bearer)
 *   INGEST_URL     Data Agent Oracle ingest, e.g. http://127.0.0.1:8730/ingest
 *   INGEST_SECRET  = Data Agent Oracle ORACLE_INGEST_SECRET (Bearer) — must equal
 *                   GetFreeQuote ORACLE_SIGNING_SECRET for signatures to verify
 */
const POLL_URL = process.env.POLL_URL || 'http://127.0.0.1:8730/poll';
const POLL_SECRET = process.env.POLL_SECRET || '';
const INGEST_URL = process.env.INGEST_URL || 'http://127.0.0.1:8730/ingest';
const INGEST_SECRET = process.env.INGEST_SECRET || '';

async function onePass() {
  const ts = new Date().toISOString();
  let events = [];

  const pollRes = await fetch(POLL_URL, { headers: { Authorization: `Bearer ${POLL_SECRET}` } });
  if (!pollRes.ok) {
    console.log(`[${ts}] poll failed HTTP ${pollRes.status}: ${await pollRes.text()}`);
    return;
  }
  const pollJson = await pollRes.json();
  events = pollJson.data || [];

  if (events.length === 0) {
    console.log(`[${ts}] poll ok, 0 pending events`);
    return;
  }

  const ingestRes = await fetch(INGEST_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${INGEST_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ events }),
  });
  const ingestJson = await ingestRes.json().catch(() => null);
  console.log(`[${ts}] relayed ${events.length} -> HTTP ${ingestRes.status}`, ingestJson ? JSON.stringify(ingestJson) : '');
}

async function main() {
  const arg = process.argv[2];
  const loop = arg === '--loop';
  const interval = Number(process.argv[3]) || 60;

  if (loop) {
    console.log(`oracle relay daemon: poll every ${interval}s`);
    for (;;) {
      try { await onePass(); } catch (e) { console.error('relay error:', e.message); }
      await new Promise((r) => setTimeout(r, interval * 1000));
    }
  } else {
    try { await onePass(); } catch (e) { console.error('relay error:', e.message); process.exit(1); }
  }
}

main();
