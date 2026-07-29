# @ledgerone/sync-server

A minimal, self-hostable relay for LedgerOne's optional cross-device sync.

**What it does and doesn't do:**
- Stores exactly one opaque, end-to-end-encrypted blob per account, plus a
  version counter used for optimistic concurrency. It never sees your
  ledger, your currencies, your PIN, or anything else in plaintext — all
  of that is encrypted client-side (see
  `apps/desktop/src/lib/sync/crypto.ts`) before it ever reaches this
  server.
- Has no concept of "users," email, or passwords. An account is just
  whatever the client derives from the sync secret it generated on the
  first device — there's no registration step, no password reset, and
  therefore nothing this server could leak that would let anyone recover
  your secret or your data.
- Does exactly two things: accept a push (optimistic-concurrency write)
  and serve a pull (read). All merge logic lives on the client.

## Running it

```bash
cd packages/sync-server
pnpm install
SYNC_DB_PATH=./sync.db PORT=8787 pnpm start
```

That's it — one process, one SQLite file. It has no other dependencies
and doesn't need Postgres, Redis, or anything else. Put it behind a
reverse proxy with TLS (Caddy, nginx, or your platform's built-in HTTPS)
for anything other than local testing — the payloads are encrypted, but
metadata like *when* an account synced is not, and plain HTTP on the open
internet is never a good idea regardless.

Point the desktop app at it from Settings → Sync, using
`https://your-domain.example` (or `http://localhost:8787` for local
development).

## Deploying

Anywhere that runs a Node process and gives you a persistent disk works:
a small VPS, Fly.io, Render, a spare Raspberry Pi on your network, or
alongside another self-hosted service you already run. There's
deliberately no Docker/orchestration requirement baked in — `node
src/index.ts` (or `pnpm start` after a build) is the whole deployment.

If you'd rather not run a standalone process at all, the HTTP contract is
small enough (two endpoints — see `src/server.ts`) to reimplement as two
Postgres functions behind Supabase Edge Functions, or an equivalent on
whatever you already host. `src/store.ts` is the entire storage contract:
port that logic and the desktop app doesn't need to change at all.

## Environment variables

| Variable        | Default      | Meaning                                  |
|-----------------|--------------|-------------------------------------------|
| `PORT`          | `8787`       | Port to listen on                         |
| `SYNC_DB_PATH`  | `./sync.db`  | Path to the SQLite file (created if absent) |

## Endpoints

- `GET /v1/sync/pull?accountId=<id>` — `Authorization: Bearer <token>`.
  Returns `{ version, blob }`. Auto-provisions the account (bound to
  whichever token is presented) on first contact.
- `POST /v1/sync/push` — `Authorization: Bearer <token>`, body
  `{ accountId, expectedVersion, blob }`. Returns `{ ok: true, version }`
  on success, or `409 { ok: false, version, blob }` if `expectedVersion`
  is stale (someone else pushed first) — the client merges against the
  returned blob and retries.
- `GET /v1/health` — liveness check, no auth.

## Tests

```bash
pnpm test
```

Runs both the storage-layer unit tests and full HTTP integration tests
against a real listening socket.
