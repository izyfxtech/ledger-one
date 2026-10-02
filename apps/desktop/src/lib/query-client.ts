import { QueryClient } from "@tanstack/react-query";

/**
 * Single QueryClient for the whole app. Everything that used to be a
 * `window.dispatchEvent("ledgerone:*-changed")` + `addEventListener` pair is
 * now an invalidation of one of the keys in `@/lib/app-queries`.
 *
 * Local SQLite is the source of truth and never goes stale on its own, so
 * queries are never refetched in the background — only when a mutation
 * invalidates them.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      gcTime: Infinity,
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
    mutations: { retry: false },
  },
});

/** Query keys double as the old event names. Invalidate these instead of
 *  dispatching a window event. */
export const appKeys = {
  security: ["security"] as const,
  onboarding: ["onboarding"] as const,
  tour: ["tour"] as const,
  users: ["users"] as const,
  displayName: ["display-name"] as const,
};
