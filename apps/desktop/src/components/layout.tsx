import { Outlet, useRouterState } from "@tanstack/react-router";
import { useSelector } from "@tanstack/react-store";
import { Toaster } from "@/components/ui/sonner";
import { AppSidebar } from "@/components/app-sidebar";
import { AppTopbar } from "@/components/app-topbar";
import { Titlebar } from "@/components/titlebar";
import { LockOverlay } from "@/components/lock-overlay";
import { TourGate } from "@/components/tour";
import { QuickCreateDialog } from "@/components/quick-create";
import { uiStore } from "@/lib/ui-store";
import { missingFxBases, useLedgerState } from "@/lib/ledger";
import { Link as RouterLink } from "@tanstack/react-router";

/** Window chrome shared by every screen, including onboarding. */
export function RootLayout() {
  const closing = useSelector(uiStore, (s) => s.windowClosing);
  return (
    <div
      className={
        "h-screen flex flex-col overflow-hidden app-exit" + (closing ? " app-exit-closing" : "")
      }
    >
      <Titlebar />
      <div className="flex-1 min-h-0">
        <Outlet />
      </div>
      <LockOverlay />
      <TourGate />
      <Toaster position="bottom-right" />
    </div>
  );
}

/** Shown when accounts exist in a currency with no USD rate. The app never
 *  fabricates a rate, so totals that mix that currency would be wrong. */
function MissingFxNotice() {
  const missing = missingFxBases(useLedgerState());
  if (missing.length === 0) return null;
  return (
    <div className="border-b border-border bg-muted/40 px-6 py-2 text-xs text-muted-foreground">
      No exchange rate to USD for {missing.join(", ")}. Totals can't include{" "}
      {missing.length === 1 ? "it" : "them"} correctly until you{" "}
      <RouterLink to="/settings" search={{ group: "money" }} className="underline text-foreground">
        add a rate in Settings
      </RouterLink>
      .
    </div>
  );
}

/** Sidebar + topbar around workspace pages. */
export function AppLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="h-full flex w-full bg-background text-foreground">
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <AppTopbar />
        <MissingFxNotice />
        <main key={pathname} className="flex-1 min-w-0 min-h-0 overflow-y-auto animate-page-in">
          <Outlet />
        </main>
      </div>
      <QuickCreateDialog />
    </div>
  );
}
