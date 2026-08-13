# Data Agent Oracle — MASTER PLAN

> **How to use:** Execute phase-by-phase. Mark `[x]` only after Success Criteria pass.
> This is the **separate paid data/agent layer** paired with GetFreeQuote (marketplace).
> Escrow/funding is excluded — payments here are for agent *data access*, handled by
> this service (not escrow).

## Vision
A cheap, queryable, signed feed of real-time needs (jobs, JIT listings, community
projects, price signals) that any autonomous agent can poll for microtransactions.
GetFreeQuote is the primary producer/consumer; this service is the system-of-record
and data market.

## Current State (foundation — 2026-08-12)
- Zero-dependency Node service: HMAC-verified `/ingest`, agent `/feed`, admin
  `/events`, and per-key `/usage` accounting. JSON-file store (Postgres later).
- **Signed events now flow from GetFreeQuote:** `emitOracleEvent` writes job/JIT/review
  events to the `oracle_events` outbox; `/api/oracle/poll` drains PENDING rows.
- **Not yet wired:** a relay worker that calls `/api/oracle/poll` and POSTs to this
  service's `/ingest`; agent key issuance; live L402 billing.

## Phased Execution

### Phase 0 — Foundation (DONE)
- [x] Ingest endpoint with HMAC verification (matches GetFreeQuote signing).
- [x] Agent `/feed` with per-key usage accounting.
- [x] Health + admin endpoints; idempotent event store.
- **Success Criteria:** `POST /ingest` accepts a signed event batch and rejects invalid
  signatures; `GET /feed` returns events and increments usage.

### Phase 1 — Relay wiring
- [ ] A relay worker (cron/daemon) drains GetFreeQuote `/api/oracle/poll` (Bearer
      `ORACLE_POLL_SECRET`) and POSTs the batch to `/ingest`.
- [ ] Shared secret (`ORACLE_SIGNING_SECRET` == `ORACLE_INGEST_SECRET`) confirmed.
- **Success Criteria:** a job created in GetFreeQuote appears in this service's `/feed`
  within the relay interval (verified end-to-end).

### Phase 2 — Agent keys + access control
- [ ] Issue per-agent API keys; `/feed` requires a valid agent key (not just the global
      secret).
- [ ] Optional scopes per agent (read-only feed vs write/query).
- **Success Criteria:** an unissued/revoked key is rejected; each agent's usage is
  isolated and counted.

### Phase 3 — L402 microtransaction billing
- [ ] Per-agent paid balance; `/feed` checks balance and debits per request.
- [ ] L402 `402 Payment Required` challenge with a payment-invoice URL on zero balance.
- [ ] Crypto/fiat settlement (see GetFreeQuote MASTER_PLAN cost model).
- **Success Criteria:** an agent with zero balance gets an L402 challenge; after payment,
  `/feed` serves and debits.

### Phase 4 — Postgres + scale
- [ ] Swap JSON store for Postgres (events, agents, invoices, ledger).
- [ ] Index event_type/entity_id; retention policy; rate limiting.
- **Success Criteria:** `pgbench`-backed inserts/reads; `/feed` P95 under target.

## Future Roadmap (do not execute yet)
- Webhooks for agents (subscribe to event_type → callback).
- Marketplace analytics / demand heatmaps sold via this oracle.
- Cross-platform ingestion (other marketplaces, gig networks).

## Metadata
- **Date:** 2026-08-12 · **Owner:** Jonathan (Jpalmer95) · **Status:** Phase 0 foundation
- Authoritative for this service. Paired doc: GetFreeQuote `MASTER_PLAN.md`.
