import { QueryClient } from "@tanstack/react-query";
import {
  type AnyRoute,
  createHashHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  notFound,
  redirect,
} from "@tanstack/react-router";
import { RootLayout, AppLayout } from "@/components/layout";
import { NotFound, RouteError, RouteFallback } from "@/components/route-error";
import { DOMAIN_TABS } from "@/components/domain-workspace";
import { onboardingQuery } from "@/lib/app-queries";
import { ledgerQuery } from "@/lib/ledger";
import { isTauriRuntime } from "@/lib/db/backend";
import { authQuery, signOutRemote } from "@/lib/cloud/auth";
import { OtherAccountDataError, startCloudSession } from "@/lib/sync/runtime";
import { initLock } from "@/lib/lock";
import { BOOT_TIME } from "@/lib/boot-time";
import { ui } from "@/lib/ui-store";
import { installTour } from "@/lib/tour";
import Home from "@/pages/Home";

const MIN_SPLASH_MS = 1200;
let splashClosed = false;

function closeSplashOnce() {
  // Only the desktop shell has a splash window.
  if (splashClosed || !isTauriRuntime()) return;
  splashClosed = true;
  const wait = Math.max(0, MIN_SPLASH_MS - (Date.now() - BOOT_TIME));
  window.setTimeout(() => {
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("close_splashscreen").catch((err) =>
        console.error("[boot] close_splashscreen failed (Rust safety-net covers it):", err),
      ),
    );
  }, wait);
}

// ---------------------------------------------------------------------------
// Root: resolves everything the old Provider/Gate components resolved with
// effects — lock state, onboarding state, ledger hydration — in loaders, so
// no component renders against half-loaded state.
// ---------------------------------------------------------------------------
const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: async ({ context, location }) => {
    // Always re-read: sign-in/sign-out change this and nothing observes the query.
    const auth = await context.queryClient.fetchQuery({ ...authQuery, staleTime: 0 });
    const onSignIn = location.pathname.startsWith("/sign-in");

    if (auth.mode === "signed-out") {
      if (!onSignIn) throw redirect({ to: "/sign-in" });
      return { auth };
    }
    if (onSignIn) throw redirect({ to: "/" }); // already signed in, or cloud is off

    if (auth.mode === "cloud") {
      try {
        // Idempotent. Works offline: it only needs the local database.
        await startCloudSession(auth.user.id);
      } catch (e) {
        if (!(e instanceof OtherAccountDataError)) throw e;
        // This device holds unsynced data from another account.
        await signOutRemote();
        await context.queryClient.invalidateQueries({ queryKey: authQuery.queryKey });
        throw redirect({ to: "/sign-in" });
      }
    }

    await initLock();
    // Fresh read (a cheap local setting): finishing onboarding must be seen immediately.
    const onboarding = await context.queryClient.fetchQuery({ ...onboardingQuery, staleTime: 0 });
    const onOnboarding = location.pathname.startsWith("/onboarding");
    if (!onboarding.complete && !onOnboarding) throw redirect({ to: "/onboarding" });
    if (onboarding.complete && onOnboarding) throw redirect({ to: "/" });
    return { auth };
  },
  loader: async ({ context }) => {
    // Nothing to load while signed out: don't touch the local database yet.
    if (context.auth.mode !== "signed-out") await context.queryClient.ensureQueryData(ledgerQuery);
    closeSplashOnce();
  },
  component: RootLayout,
  pendingComponent: RouteFallback,
  errorComponent: RouteError,
  notFoundComponent: NotFound,
});

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "sign-in",
  validateSearch: (s: Record<string, unknown>): { mode?: "signin" | "signup" } => ({
    mode: s.mode === "signup" ? "signup" : undefined,
  }),
  component: lazyRouteComponent(() => import("@/pages/SignIn")),
});

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "onboarding",
  loader: async () => (await import("@/components/onboarding")).startOnboardingDraft(),
  component: lazyRouteComponent(() => import("@/components/onboarding"), "OnboardingPage"),
});

// Pathless layout: sidebar + topbar around every workspace page.
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  component: AppLayout,
});

const homeRoute = createRoute({ getParentRoute: () => appRoute, path: "/", component: Home });
const reportsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "reports",
  validateSearch: (s: Record<string, unknown>): { tab?: string } => ({
    tab: typeof s.tab === "string" ? s.tab : undefined,
  }),
  component: lazyRouteComponent(() => import("@/pages/Reports")),
});
const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "settings",
  validateSearch: (s: Record<string, unknown>): { group?: string } => ({
    group: typeof s.group === "string" ? s.group : undefined,
  }),
  component: lazyRouteComponent(() => import("@/pages/Settings")),
});
const transactionRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "transactions/$id",
  component: lazyRouteComponent(() => import("@/pages/DetailPages"), "TransactionPage"),
});

// One factory for the routes shared by /personal and /businesses/$domain.
// Unknown tabs are a real 404 instead of silently rendering Overview, and
// `liabilities/$id` now exists (the links to it used to fall through to *).
function domainRoutes(p: AnyRoute) {
  const page = lazyRouteComponent(() => import("@/pages/DomainPage"));
  const detail = (path: string, name: "AccountPage" | "AllocationPage" | "GoalPage") =>
    createRoute({
      getParentRoute: () => p,
      path,
      component: lazyRouteComponent(() => import("@/pages/DetailPages"), name),
    });
  return [
    createRoute({ getParentRoute: () => p, path: "/", component: page }),
    detail("accounts/$id", "AccountPage"),
    detail("liabilities/$id", "AccountPage"),
    detail("allocations/$id", "AllocationPage"),
    detail("goals/$id", "GoalPage"),
    createRoute({
      getParentRoute: () => p,
      path: "$tab",
      beforeLoad: ({ params }) => {
        if (!(DOMAIN_TABS as readonly string[]).includes(params.tab) || params.tab === "overview") {
          throw notFound();
        }
      },
      component: page,
    }),
  ];
}

const personalRoute = createRoute({ getParentRoute: () => appRoute, path: "personal" });
const businessesRoute = createRoute({ getParentRoute: () => appRoute, path: "businesses" });
const businessesIndexRoute = createRoute({
  getParentRoute: () => businessesRoute,
  path: "/",
  component: lazyRouteComponent(() => import("@/pages/BusinessesIndex")),
});
const businessRoute = createRoute({ getParentRoute: () => businessesRoute, path: "$domain" });

const routeTree = rootRoute.addChildren([
  signInRoute,
  onboardingRoute,
  appRoute.addChildren([
    homeRoute,
    reportsRoute,
    settingsRoute,
    transactionRoute,
    personalRoute.addChildren(domainRoutes(personalRoute)),
    businessesRoute.addChildren([
      businessesIndexRoute,
      businessRoute.addChildren(domainRoutes(businessRoute)),
    ]),
  ]),
]);

export function createAppRouter(queryClient: QueryClient) {
  const router = createRouter({
    routeTree,
    history: createHashHistory(), // Tauri serves from a custom protocol; hash routing needs no server
    context: { queryClient },
    defaultPreload: "intent",
    defaultPendingComponent: RouteFallback,
    defaultErrorComponent: RouteError,
    defaultNotFoundComponent: NotFound,
  });
  // Close the mobile drawer after any navigation (was an effect).
  router.subscribe("onResolved", () => ui.setMobileNav(false));
  installTour((o) => router.navigate(o as never), queryClient);
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
