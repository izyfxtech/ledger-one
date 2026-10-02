// Runs the sync engine against the REAL migration (supabase/migrations) in a
// local Postgres. Skipped unless TEST_PG_URL is set, e.g.
//   TEST_PG_URL=postgres://postgres@localhost/ledgerone_test pnpm test
// (create the database with supabase/tests/run-local.sh first).
import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createWebBackend } from "@/lib/db/web-backend";
import { runSyncCycle } from "@/lib/sync/engine";
import { Outbox } from "@/lib/sync/outbox";
import type { PushRow, Remote, RemoteRow } from "@/lib/sync/remote";

const url = process.env.TEST_PG_URL;
const d = url ? describe : describe.skip;

/** A Remote that talks to Postgres exactly as PostgREST would: as the
 *  `authenticated` role with the user's id in the JWT claim, so RLS applies. */
function pgRemote(pool: pg.Pool, uid: string): Remote {
  const as = async <T>(fn: (c: pg.PoolClient) => Promise<T>) => {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
      await c.query("set local role authenticated");
      const out = await fn(c);
      await c.query("commit");
      return out;
    } catch (e) {
      await c.query("rollback");
      throw e;
    } finally {
      c.release();
    }
  };
  return {
    pull: (after, limit) =>
      as(async (c) => {
        const r = await c.query(
          "select kind,id,data,deleted,updated_at,server_seq from public.ledger_entities where server_seq > $1 order by server_seq limit $2",
          [after, limit],
        );
        return r.rows.map((x): RemoteRow => ({
          ...x,
          updated_at: new Date(x.updated_at).toISOString(),
          server_seq: Number(x.server_seq),
        }));
      }),
    push: (rows: PushRow[]) =>
      as(async (c) => {
        const r = await c.query("select public.push_ledger_entities($1::jsonb) as n", [
          JSON.stringify(rows),
        ]);
        return r.rows[0].n as number;
      }),
  };
}

d("sync engine against the real Postgres migration", () => {
  let pool: pg.Pool;
  const USER_A = "00000000-0000-0000-0000-0000000000a1";
  const USER_B = "00000000-0000-0000-0000-0000000000b1";
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    await pool.query("insert into auth.users(id) values ($1),($2) on conflict do nothing", [
      USER_A,
      USER_B,
    ]);
    await pool.query("delete from public.ledger_entities where user_id in ($1,$2)", [
      USER_A,
      USER_B,
    ]);
    await pool.query("delete from public.ledger_cursors where user_id in ($1,$2)", [
      USER_A,
      USER_B,
    ]);
  });
  afterAll(async () => pool.end());

  async function device(uid: string) {
    const db = createWebBackend(`pg-${Math.random()}`);
    await db.ensureInitialized();
    const outbox = new Outbox(db);
    await outbox.activate(uid);
    const remote = pgRemote(pool, uid);
    return { db, outbox, sync: () => runSyncCycle({ db, outbox, remote, uid, pageSize: 3 }) };
  }
  const o = (id: string, name: string) => ({
    id,
    domainId: "personal",
    name,
    kind: "account" as const,
    currency: "USD" as const,
  });

  it("round-trips real data between two devices of one user, and isolates another user", async () => {
    const a = await device(USER_A);
    const b = await device(USER_A);
    const other = await device(USER_B);

    for (let i = 0; i < 7; i++) {
      await a.db.insertObject(o(`o${i}`, `Account ${i}`));
      a.outbox.markChanged("object", `o${i}`, false);
    }
    await a.db.upsertFxRate({ base: "NGN", quote: "USD", rate: 0.00066 });
    a.outbox.markChanged("fx", "NGN", false);
    expect(await a.sync()).toMatchObject({ ok: true, pushed: 8 });

    expect(await b.sync()).toMatchObject({ ok: true, applied: 8 });
    const s = await b.db.selectLedgerState();
    expect(s.objects).toHaveLength(7);
    expect(s.fx).toEqual([{ base: "NGN", quote: "USD", rate: 0.00066 }]);

    // delete on B reaches A
    await b.db.deleteObject("o3");
    b.outbox.markChanged("object", "o3", true);
    await b.sync();
    await a.sync();
    expect((await a.db.selectLedgerState()).objects.map((x) => x.id)).not.toContain("o3");

    // another user sees none of it
    await other.sync();
    expect((await other.db.selectLedgerState()).objects).toEqual([]);
  });
});
