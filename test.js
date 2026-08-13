const crypto = require('crypto');
const BASE = 'http://127.0.0.1:8731';
const INGEST = 'testsecret';
const AGENT = 'agentsecret';

function sign(secret, canonical) {
  return crypto.createHmac('sha256', secret).update(canonical).digest('hex');
}

async function j(path, opts = {}) {
  const r = await fetch(BASE + path, opts);
  return { status: r.status, body: await r.json().catch(() => null) };
}

(async () => {
  console.log('health:', JSON.stringify(await j('/health')));

  const payload = { title: 'Fix roof', category: 'Roofing' };
  const canonical = `job.created:job:job-abc:1:${JSON.stringify(payload)}`;
  const evt = {
    id: 'evt-1', event_type: 'job.created', entity_type: 'job', entity_id: 'job-abc',
    version: 1, payload, signature: sign(INGEST, canonical), nonce: 'n1', created_at: '2026-08-12T00:00:00Z',
  };

  const ok = await j('/ingest', { method: 'POST', headers: { Authorization: `Bearer ${INGEST}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ events: [evt] }) });
  console.log('ingest (valid sig):', JSON.stringify(ok));

  const bad = { ...evt, id: 'evt-bad', signature: 'deadbeef' };
  const rej = await j('/ingest', { method: 'POST', headers: { Authorization: `Bearer ${INGEST}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ events: [bad] }) });
  console.log('ingest (bad sig, should add 0):', JSON.stringify(rej));

  const feed = await j('/feed?type=job.created', { headers: { Authorization: `Bearer ${AGENT}` } });
  console.log('feed:', JSON.stringify(feed).slice(0, 200));

  const noKey = await j('/feed');
  console.log('feed no key status:', noKey.status, JSON.stringify(noKey.body));

  const usage = await j('/usage', { headers: { Authorization: `Bearer ${INGEST}` } });
  console.log('usage:', JSON.stringify(usage.body));
})().catch((e) => { console.error(e); process.exit(1); });
