// @vitest-environment jsdom
// The signed-in experience, end to end, against a fake Supabase: redirect to
// sign-in, wrong password, correct password pulling the account's existing data
// onto a fresh device (skipping first-run setup), then sign-out wiping the
// device. Exercises the router guards, sign-in page, sync runtime and the
// IndexedDB backend together.
import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
vi.stubEnv("VITE_SUPABASE_URL", "http://fake.supabase.test");
vi.stubEnv("VITE_SUPABASE_ANON_KEY", "fake-anon-key");

class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as Record<string, unknown>).ResizeObserver = RO;
Element.prototype.scrollIntoView = () => {};
window.matchMedia ??= ((q: string) => ({
  matches: false,
  media: q,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
})) as never;
window.confirm = () => true;

// ---- a tiny fake of the parts of supabase-js the app uses ------------------
type Row = {
  kind: string;
  id: string;
  data: unknown;
  deleted: boolean;
  updated_at: string;
  server_seq: number;
};
const fake = vi.hoisted(() => ({
  rows: new Map<string, Row>(),
  seq: 0,
  session: null as null | { user: { id: string; email: string } },
}));

function chain(table: string) {
  let after = 0;
  let max = 1000;
  const q = {
    select: () => q,
    gt: (_c: string, v: number) => ((after = v), q),
    order: () => q,
    limit: (n: number) => ((max = n), q),
    then: (res: (v: unknown) => unknown) =>
      res({
        data: [...fake.rows.values()]
          .filter((r) => r.server_seq > after)
          .sort((a, b) => a.server_seq - b.server_seq)
          .slice(0, max),
        error: null,
      }),
  };
  void table;
  return q;
}

vi.mock("@supabase/supabase-js", () => ({
  isAuthRetryableFetchError: (e: { name?: string } | null) => e?.name === "AuthRetryableFetchError",
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: fake.session }, error: null }),
      signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
        if (password !== "correct-horse")
          return { data: {}, error: { message: "Invalid login credentials" } };
        fake.session = { user: { id: "user-1", email } };
        return { data: {}, error: null };
      },
      signUp: async () => ({ data: { session: null }, error: null }),
      signOut: async () => ((fake.session = null), { error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: (t: string) => chain(t),
    rpc: async (_n: string, { rows }: { rows: Omit<Row, "server_seq">[] }) => {
      let applied = 0;
      for (const r of rows) {
        const k = `${r.kind}:${r.id}`;
        const cur = fake.rows.get(k);
        if (cur && !(Date.parse(r.updated_at) > Date.parse(cur.updated_at))) continue;
        fake.rows.set(k, { ...r, server_seq: ++fake.seq });
        applied++;
      }
      return { data: applied, error: null };
    },
    channel: () => ({
      on() {
        return this;
      },
      subscribe() {
        return this;
      },
    }),
    removeChannel: () => {},
  }),
}));

const seed = (kind: string, id: string, data: unknown) =>
  fake.rows.set(`${kind}:${id}`, {
    kind,
    id,
    data,
    deleted: false,
    updated_at: "2026-01-01T00:00:00.000Z",
    server_seq: ++fake.seq,
  });

describe("signed-in flow", () => {
  let unmount: () => void;
  let container: HTMLElement;
  beforeAll(() => {
    // The account already has data from another device.
    seed("object", "o1", {
      id: "o1",
      domainId: "personal",
      name: "Savings from my other device",
      kind: "account",
      currency: "USD",
    });
    seed("transaction", "t1", {
      id: "t1",
      date: "2026-01-05",
      description: "Salary",
      kind: "income",
      entries: [{ objectId: "o1", amount: 1000 }],
    });
    window.location.hash = "#/";
  });
  afterAll(() => {
    unmount?.();
    cleanup();
  });

  it("walks sign-in → synced workspace → sign-out", async () => {
    const { queryClient } = await import("@/lib/query-client");
    const { createAppRouter } = await import("@/router");
    const router = createAppRouter(queryClient);
    const r = render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    unmount = r.unmount;
    container = r.container;

    // 1. Not signed in → sent to the sign-in page.
    await waitFor(() => expect(window.location.hash).toContain("/sign-in"), { timeout: 5000 });
    const email = await screen.findByPlaceholderText("you@email.com");
    const password = () => container.querySelector('input[type="password"]') as HTMLInputElement;
    const submit = () => fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    // 2. Wrong password is refused with the server's message.
    fireEvent.change(email, { target: { value: "me@example.com" } });
    fireEvent.change(password(), { target: { value: "wrong-password" } });
    submit();
    expect(
      await screen.findByText(/invalid login credentials/i, {}, { timeout: 5000 }),
    ).toBeTruthy();
    expect(window.location.hash).toContain("/sign-in");

    // 3. Right password: lands in the workspace (NOT first-run setup), with the
    //    account's data now stored locally.
    fireEvent.change(password(), { target: { value: "correct-horse" } });
    submit();
    await waitFor(() => expect(window.location.hash).not.toContain("/sign-in"), { timeout: 8000 });
    expect(window.location.hash).not.toContain("/onboarding");
    const { selectLedgerState } = await import("@/lib/db/queries");
    const local = await selectLedgerState();
    expect(local.objects.map((o) => o.name)).toEqual(["Savings from my other device"]);
    expect(local.transactions.map((t) => t.description)).toEqual(["Salary"]);

    // 4. Sign out wipes this device and returns to sign-in.
    window.location.hash = "#/settings?group=account";
    const out = await screen.findByRole("button", { name: /sign out/i }, { timeout: 5000 });
    fireEvent.click(out);
    await waitFor(() => expect(window.location.hash).toContain("/sign-in"), { timeout: 8000 });
    const after = await selectLedgerState();
    expect(after.objects).toEqual([]);
    expect(after.transactions).toEqual([]);
    expect(fake.rows.size).toBe(2); // the account's data is untouched in the cloud
  }, 40000);
});
