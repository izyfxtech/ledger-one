// @vitest-environment jsdom
// Boots the REAL app (router, loaders, layout, pages) the way a browser would:
// no Tauri, IndexedDB for storage, cloud not configured. Proves the web path
// starts, onboards a brand-new user, and persists their data.
import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;

// jsdom lacks these; the UI libraries expect them.
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

describe("web build boots without the desktop shell", () => {
  let unmount: () => void;
  beforeAll(() => {
    window.location.hash = "#/";
  });
  afterAll(() => {
    unmount?.();
    cleanup();
  });

  it("shows first-run setup, lets you skip it, and lands on an empty workspace", async () => {
    const { queryClient } = await import("@/lib/query-client");
    const { createAppRouter } = await import("@/router");
    const router = createAppRouter(queryClient);
    const r = render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    unmount = r.unmount;

    // New browser, nothing stored: first-run onboarding.
    await waitFor(() => expect(window.location.hash).toContain("/onboarding"), { timeout: 5000 });

    // Skip it.
    const skip = await screen.findByText(/skip/i, {}, { timeout: 5000 });
    fireEvent.click(skip);

    // Workspace opens, with no invented data.
    await waitFor(() => expect(window.location.hash).toMatch(/#\/$|#\/?$/), { timeout: 5000 });
    const { selectLedgerState } = await import("@/lib/db/queries");
    const state = await selectLedgerState();
    expect(state.domains.map((d) => d.id)).toEqual(["personal"]);
    expect(state.objects).toEqual([]);
    expect(state.transactions).toEqual([]);

    // And it remembered: onboarding is marked complete in IndexedDB.
    const { loadOnboarding } = await import("@/lib/local-store");
    expect((await loadOnboarding()).complete).toBe(true);
  }, 20000);
});
