import { createStore } from "@tanstack/react-store";
import type { QuickKind } from "@/components/quick-create";

// Client-only UI state, in one TanStack Store. Replaces: the
// SidebarShellProvider context, the `ledgerone:quick-create` window event
// bus, AppTopbar's local palette/quick-create state, and App's `closing`
// state.

const SIDEBAR_KEY = "ledgerone.sidebar.collapsed";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

export const uiStore = createStore({
  sidebarCollapsed: readCollapsed(),
  mobileNavOpen: false,
  paletteOpen: false,
  paletteQuery: "",
  quickKind: null as QuickKind | null,
  /** Domain the quick-create dialog should default to. */
  quickDomainId: null as string | null,
  windowClosing: false,
});

// Persist the one piece of UI state that should survive a relaunch.
let lastCollapsed = uiStore.get().sidebarCollapsed;
uiStore.subscribe((s) => {
  if (s.sidebarCollapsed === lastCollapsed) return;
  lastCollapsed = s.sidebarCollapsed;
  try {
    window.localStorage.setItem(SIDEBAR_KEY, s.sidebarCollapsed ? "1" : "0");
  } catch {
    /* ignore */
  }
});

export const ui = {
  toggleSidebar: () => uiStore.setState((s) => ({ ...s, sidebarCollapsed: !s.sidebarCollapsed })),
  setMobileNav: (open: boolean) => uiStore.setState((s) => ({ ...s, mobileNavOpen: open })),
  // Closing also clears the search text (it used to be stale on reopen).
  setPalette: (open: boolean) =>
    uiStore.setState((s) => ({
      ...s,
      paletteOpen: open,
      paletteQuery: open ? s.paletteQuery : "",
    })),
  togglePalette: () => ui.setPalette(!uiStore.get().paletteOpen),
  setPaletteQuery: (q: string) => uiStore.setState((s) => ({ ...s, paletteQuery: q })),
  openQuickCreate: (kind: QuickKind, domainId: string | null = null) =>
    uiStore.setState((s) => ({ ...s, quickKind: kind, quickDomainId: domainId })),
  closeQuickCreate: () => uiStore.setState((s) => ({ ...s, quickKind: null })),
  setWindowClosing: (v: boolean) => uiStore.setState((s) => ({ ...s, windowClosing: v })),
};
