import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { HashRouter, Routes, Route, Outlet, Link, useLocation } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { Toaster } from "@/components/ui/sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { LedgerProvider } from "@/lib/ledger";
import { AppSidebar } from "@/components/app-sidebar";
import { AppTopbar } from "@/components/app-topbar";
import { Titlebar } from "@/components/titlebar";
import { SidebarShellProvider } from "@/components/sidebar-shell";
import { ErrorBoundary } from "@/components/error-boundary";
import { LockGate } from "@/components/lock-gate";
import { OnboardingGate } from "@/components/onboarding";
import { TourGate } from "@/components/tour";

// Home stays eager: it's the index route, loaded on every cold boot.
import Home from "@/pages/Home";

// Everything else lazy-loads on first navigation. Reports alone pulls in
// recharts, and DomainWorkspacePage/Settings are large — splitting these
// out keeps the initial bundle to what boot actually needs.
const BusinessesIndex = lazy(() => import("@/pages/BusinessesIndex"));
const DomainWorkspacePage = lazy(() => import("@/pages/DomainWorkspacePage"));
const AccountDetailPage = lazy(() => import("@/pages/AccountDetailPage"));
const AllocationDetailPage = lazy(() => import("@/pages/AllocationDetailPage"));
const GoalDetailPage = lazy(() => import("@/pages/GoalDetailPage"));
const TransactionDetailPage = lazy(() => import("@/pages/TransactionDetailPage"));
const ReportsPage = lazy(() => import("@/pages/Reports"));
const SettingsPage = lazy(() => import("@/pages/Settings"));

function RouteFallback() {
  return (
    <div className="mx-auto max-w-7xl px-8 py-8 space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-96" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function Layout() {
  const { pathname } = useLocation();
  return (
    <SidebarShellProvider>
      <div className="h-full flex w-full bg-background text-foreground">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <AppTopbar />
          <main key={pathname} className="flex-1 min-w-0 animate-page-in">
            <Suspense fallback={<RouteFallback />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>
    </SidebarShellProvider>
  );
}

function NotFound() {
  return (
    <div className="flex h-full items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-mono text-7xl font-medium text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-medium">Not in the ledger</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This page doesn't exist.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Back to workspace
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

  // Play a short exit transition instead of letting the window just vanish.
  // Guarded by closingRef so a second close signal (e.g. Cmd/Ctrl+Q while
  // the animation is already running) can't re-enter this and hang.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let appWindow: ReturnType<typeof getCurrentWindow> | null = null;
    try {
      appWindow = getCurrentWindow();
    } catch {
      return;
    }
    appWindow
      .onCloseRequested(async (event) => {
        if (closingRef.current) return;
        closingRef.current = true;
        event.preventDefault();
        setClosing(true);
        window.setTimeout(() => {
          appWindow?.destroy().catch(() => {});
        }, 260);
      })
      .then((f) => { unlisten = f; })
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  return (
    <div className={"h-screen flex flex-col overflow-hidden app-exit" + (closing ? " app-exit-closing" : "")}>
      <Titlebar />
      <div className="flex-1 min-h-0">
        <ErrorBoundary>
          <LedgerProvider>
            <LockGate>
              <OnboardingGate>
                <HashRouter>
                  <Routes>
                    <Route element={<Layout />}>
                      <Route index element={<Home />} />

                      <Route path="personal">
                        <Route index element={<DomainWorkspacePage domainId="personal" basePath="/personal" />} />
                        <Route path="accounts/:id" element={<AccountDetailPage basePath="/personal" />} />
                        <Route path="allocations/:id" element={<AllocationDetailPage basePath="/personal" />} />
                        <Route path="goals/:id" element={<GoalDetailPage basePath="/personal" />} />
                        <Route path=":tab" element={<DomainWorkspacePage domainId="personal" basePath="/personal" />} />
                      </Route>

                      <Route path="businesses">
                        <Route index element={<BusinessesIndex />} />
                        <Route path=":domain">
                          <Route index element={<DomainWorkspacePage />} />
                          <Route path="accounts/:id" element={<AccountDetailPage />} />
                          <Route path="allocations/:id" element={<AllocationDetailPage />} />
                          <Route path="goals/:id" element={<GoalDetailPage />} />
                          <Route path=":tab" element={<DomainWorkspacePage />} />
                        </Route>
                      </Route>

                      <Route path="transactions/:id" element={<TransactionDetailPage />} />
                      <Route path="reports" element={<ReportsPage />} />
                      <Route path="settings" element={<SettingsPage />} />

                      <Route path="*" element={<NotFound />} />
                    </Route>
                  </Routes>
                  {/* Tour lives inside the router so it can navigate between steps. */}
                  <TourGate />
                </HashRouter>
                <Toaster position="bottom-right" />
              </OnboardingGate>
            </LockGate>
          </LedgerProvider>
        </ErrorBoundary>
      </div>
    </div>
  );
}
