# Data Agent Oracle

The paid agent-oracle that backs the **GetFreeQuote** ecosystem's real-time needs
feed. It ingests HMAC-signed events relayed from GetFreeQuote's oracle outbox,
stores them, and serves a queryable feed to third-party agents — with per-key
usage accounting that is the foundation for **L402-style microtransaction billing**.

This is the **system-of-record / data market layer** (see the layered-architecture
decision in GetFreeQuote's `MASTER_PLAN.md`). GetFreeQuote (the marketplace) is the
primary producer *and* consumer; third-party agents pay to poll the feed.

## How it fits

```
GetFreeQuote platform
  emitOracleEvent()  ->  oracle_events outbox (signed, PENDING)
      /api/oracle/poll (Bearer ORACLE_POLL_SECRET)   <- relay worker drains PENDING
                 |
                 v
  Data Agent Oracle  POST /ingest (HMAC-verified)  ->  event store
                 |
                 v
  Agents  GET /feed (Bearer agent key)  ->  real-time needs  (+ /usage billing)
```

## Quick start

```bash
# GetFreeQuote side: set the shared secret so signatures match
#   ORACLE_SIGNING_SECRET  (GetFreeQuote .env.local)
#   ORACLE_INGEST_SECRET   (this service — must be the SAME value)

# Run this service
export ORACLE_INGEST_SECRET='<shared-secret>'
export ORACLE_AGENT_SECRET='<secret-you-issue-to-agents>'
export PORT=8730
node server.js
```

## Endpoints

| Method | Path       | Auth (Bearer)        | Purpose |
|--------|------------|----------------------|---------|
| GET    | `/health`  | none                 | liveness + event count |
| POST   | `/ingest`  | `ORACLE_INGEST_SECRET` | Accept a batch of signed events (idempotent by event id; HMAC-verified) |
| GET    | `/feed`    | `ORACLE_AGENT_SECRET` | Query real-time needs (`?type=job.created&limit=50`); increments usage |
| GET    | `/events`  | `ORACLE_INGEST_SECRET` | Admin listing of stored events |
| GET    | `/usage`   | `ORACLE_INGEST_SECRET` | Per-agent request counts (billing data) |

## HMAC verification

Events must be signed with `HMAC-SHA256(ORACLE_INGEST_SECRET, "<event_type>:<entity_type>:<entity_id>:<version>:<JSON payload>")`.
This matches GetFreeQuote's `emitOracleEvent` service, so relays pass through
unchanged. Unsigned/invalid events are dropped.

## Production notes

- **Storage:** default is an append-only JSON file (`./data/oracle.json`). Swap for
  Postgres/Redis when scaling (keep the idempotency + HMAC checks).
- **Billing:** `/usage` tracks requests per agent key. To go L402 live, issue each
  paying agent a key, enforce a paid balance before serving `/feed`, and debit per
  request. See `MASTER_PLAN.md`.
- **Deploy:** containerize (`node server.js`) behind Traefik/Coolify on the droplet,
  or anywhere with egress to the GetFreeQuote outbox. TLS termination by the proxy.
