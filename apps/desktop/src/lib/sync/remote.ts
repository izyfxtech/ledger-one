import type { SupabaseClient } from "@supabase/supabase-js";

/** A row as stored on the server. */
export type RemoteRow = {
  kind: string;
  id: string;
  data: unknown | null;
  deleted: boolean;
  updated_at: string;
  server_seq: number;
};

/** A row as sent to the server (it assigns server_seq). */
export type PushRow = Omit<RemoteRow, "server_seq">;

/** The cloud, as the sync engine sees it. Supabase implements it for real; the
 *  tests implement it in memory and against a local Postgres. */
export interface Remote {
  /** Rows with server_seq > afterSeq, oldest first. */
  pull(afterSeq: number, limit: number): Promise<RemoteRow[]>;
  /** Apply rows (last-writer-wins on the server). Returns how many applied. */
  push(rows: PushRow[]): Promise<number>;
}

const PUSH_CHUNK = 500;

export function supabaseRemote(client: SupabaseClient): Remote {
  return {
    async pull(afterSeq, limit) {
      const { data, error } = await client
        .from("ledger_entities")
        .select("kind,id,data,deleted,updated_at,server_seq")
        .gt("server_seq", afterSeq)
        .order("server_seq", { ascending: true })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as RemoteRow[];
    },
    async push(rows) {
      let applied = 0;
      for (let i = 0; i < rows.length; i += PUSH_CHUNK) {
        const { data, error } = await client.rpc("push_ledger_entities", {
          rows: rows.slice(i, i + PUSH_CHUNK),
        });
        if (error) throw error;
        applied += typeof data === "number" ? data : 0;
      }
      return applied;
    },
  };
}
