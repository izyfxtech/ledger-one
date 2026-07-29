import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Sparkles, ChevronLeft, ChevronRight, X } from "lucide-react";
import { loadTour, setTourComplete, loadDisplayName } from "@/lib/local-store";

// Lightweight in-app product tour. Only fires when explicitly started (end
// of onboarding, or Settings → Restart tour) — see `loadTour()` default.
// Steps can request a `path` navigation before highlighting a target, and
// we poll for the target so we don't race the route transition.

type TourStep = {
  target: string; // css selector, usually `[data-tour="..."]`
  title: string;
  body: string;
  side?: "right" | "bottom" | "left" | "top";
  padding?: number;
  path?: string; // navigate before showing
};

function buildSteps(name: string): TourStep[] {
  const who = name.trim() || "there";
  return [
    { target: '[data-tour="user-badge"]', side: "right", path: "/",
      title: `Welcome, ${who}!`,
      body: "This is your workspace. Everything lives on this device — no accounts, no cloud. 60 seconds and you'll know the whole app." },

    { target: '[data-tour="nav-home"]', side: "right",
      title: "Home",
      body: "A read-only dashboard: net worth, cash available, recent activity, and what's due next. Every number is derived from your ledger." },

    { target: '[data-tour="nav-personal"]', side: "right",
      title: "Personal",
      body: "Your personal domain — its own accounts, transactions, budget, goals, allocations, categories, analytics, and settings." },

    { target: '[data-tour="domain-tabs"]', side: "bottom", path: "/personal",
      title: "Domain tabs",
      body: "Every domain has the same nine tabs: Overview, Accounts, Liabilities, Transactions, Budget, Allocations, Goals, Categories, Analytics — and a Settings tab for domain-only preferences." },

    { target: '[data-tab="accounts"]', side: "bottom",
      title: "Accounts",
      body: "Where money physically exists — bank, cash, wallet, investments. Balances are computed live from transactions." },

    { target: '[data-tab="liabilities"]', side: "bottom",
      title: "Liabilities",
      body: "Loans, credit cards, mortgages. Metadata (interest, min payment, due day) drives the upcoming reminders on Home." },

    { target: '[data-tab="transactions"]', side: "bottom",
      title: "Transactions",
      body: "The single source of truth. Every balance, budget, goal and report is derived from this ledger." },

    { target: '[data-tab="budget"]', side: "bottom",
      title: "Budget",
      body: "Plan spending per category for a month. Progress bars go red when you're close to or over a line." },

    { target: '[data-tab="allocations"]', side: "bottom",
      title: "Allocations",
      body: "Reserve money without moving it — e.g. \"Emergency fund\" living inside your checking account." },

    { target: '[data-tab="goals"]', side: "bottom",
      title: "Goals",
      body: "Track future objectives with a target amount and a deadline. Link to an allocation to auto-track funding." },

    { target: '[data-tab="categories"]', side: "bottom",
      title: "Categories",
      body: "Income and expense taxonomy for this domain. Used by budgets, reports, and transactions." },

    { target: '[data-tab="analytics"]', side: "bottom",
      title: "Analytics",
      body: "Cash flow, net-worth trend, category breakdowns — all scoped to this domain." },

    { target: '[data-tab="settings"]', side: "bottom",
      title: "Domain settings",
      body: "Rename, describe, or give a domain its own display currency — perfect for a USD trading book beside NGN personal finances." },

    { target: '[data-tour="nav-businesses"]', side: "right", path: "/businesses",
      title: "Businesses",
      body: "Each venture is its own domain with the exact same nine tabs — a self-contained mini finance app." },

    { target: '[data-tour="nav-reports"]', side: "right", path: "/reports",
      title: "Reports",
      body: "Workspace-wide: net worth by domain, cash flow, balance sheet, income statement, currency exposure, business comparison, and exports." },

    { target: '[data-tour="nav-settings"]', side: "right", path: "/settings",
      title: "Settings",
      body: "Workspace name, default currency, FX rates, appearance, backup/import/export, security PIN, users, and data reset." },

    { target: '[data-tour="theme"]', side: "bottom",
      title: "Dark mode",
      body: "One-click light/dark. Follows your OS by default — override any time from Appearance in Settings." },

    { target: '[data-tour="search"]', side: "bottom",
      title: "Search & command",
      body: "⌘K anywhere to jump to accounts, transactions, pages. Muscle memory pays off fast." },

    { target: '[data-tour="new"]', side: "bottom",
      title: "Quick create",
      body: "Log a transaction, transfer, account, liability, allocation, goal, business, or budget — from anywhere." },
  ];
}

export function TourGate() {
  const [open, setOpen] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      loadTour().then((s) => {
        if (!cancelled) setOpen(!s.complete);
      });
    };
    sync();
    window.addEventListener("ledgerone:tour-changed", sync);
    return () => {
      cancelled = true;
      window.removeEventListener("ledgerone:tour-changed", sync);
    };
  }, []);

  if (!open) return null;
  return <Tour onDone={() => setOpen(false)} />;
}

function Tour({ onDone }: { onDone: () => void }) {
  const stepsRef = useRef<TourStep[]>(buildSteps(loadDisplayName()));
  const steps = stepsRef.current;
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[i];
  const navigate = useNavigate();

  // Navigate on step entry if the step points to a different path.
  useEffect(() => {
    if (step.path) navigate(step.path);
  }, [i, step.path, navigate]);

  // Poll for the target after route change (up to ~2s).
  useLayoutEffect(() => {
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = () => {
      if (cancelled) return;
      const el = document.querySelector(step.target) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        setRect(el.getBoundingClientRect());
      } else if (attempts++ < 20) {
        timer = setTimeout(tick, 100);
        return;
      } else {
        setRect(null);
      }
    };
    tick();

    const onResize = () => {
      const el = document.querySelector(step.target) as HTMLElement | null;
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [step.target, i]);

  function done() {
    setTourComplete();
    onDone();
  }

  function next() {
    if (i >= steps.length - 1) done();
    else setI(i + 1);
  }

  const pad = step.padding ?? 6;
  const spot = rect
    ? {
        top: Math.max(rect.top - pad, 4),
        left: Math.max(rect.left - pad, 4),
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }
    : null;

  const cardW = 340;
  const cardH = 220;
  const gap = 12;
  let cardStyle: React.CSSProperties = {
    position: "fixed",
    top: `50%`,
    left: `50%`,
    transform: "translate(-50%, -50%)",
    width: cardW,
    zIndex: 10000,
  };
  if (spot) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const side = step.side ?? "bottom";
    let top = 0;
    let left = 0;
    if (side === "right") { top = spot.top; left = spot.left + spot.width + gap; }
    else if (side === "left") { top = spot.top; left = spot.left - cardW - gap; }
    else if (side === "top") { top = spot.top - cardH - gap; left = spot.left + spot.width / 2 - cardW / 2; }
    else { top = spot.top + spot.height + gap; left = spot.left + spot.width / 2 - cardW / 2; }
    left = Math.max(8, Math.min(vw - cardW - 8, left));
    top = Math.max(8, Math.min(vh - cardH - 8, top));
    cardStyle = { position: "fixed", top, left, width: cardW, zIndex: 10000 };
  }

  return (
    <>
      {spot ? (
        <Backdrop spot={spot} />
      ) : (
        <div className="fixed inset-0 z-[9998] bg-ink/40 backdrop-blur-[2px]" />
      )}

      <div
        style={cardStyle}
        className="rounded-xl border bg-card shadow-xl p-4 animate-in fade-in slide-in-from-bottom-2 duration-200"
      >
        <div className="flex items-start gap-2">
          <div className="rounded-md bg-primary/15 text-primary p-1.5 mt-0.5">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">
              Tour · {i + 1}/{steps.length}
            </div>
            <div className="mt-0.5 font-semibold">{step.title}</div>
          </div>
          <button
            type="button"
            aria-label="Skip tour"
            onClick={done}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          {step.body}
        </p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="flex gap-1 flex-wrap max-w-[60%]">
            {steps.map((_, j) => (
              <span
                key={j}
                className={`h-1 w-3 rounded-full transition-colors ${
                  j <= i ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {i > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setI(i - 1)}>
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
            )}
            <Button size="sm" onClick={next}>
              {i >= steps.length - 1 ? "Get started" : "Next"}
              {i < steps.length - 1 && <ChevronRight className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

function Backdrop({ spot }: { spot: { top: number; left: number; width: number; height: number } }) {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1440;
  const vh = typeof window !== "undefined" ? window.innerHeight : 900;
  const cls = "fixed z-[9998] bg-ink/50 backdrop-blur-[1.5px] transition-all duration-200";
  const parts: ReactNode[] = [
    <div key="t" className={cls} style={{ top: 0, left: 0, width: vw, height: spot.top }} />,
    <div key="b" className={cls} style={{ top: spot.top + spot.height, left: 0, width: vw, height: Math.max(vh - (spot.top + spot.height), 0) }} />,
    <div key="l" className={cls} style={{ top: spot.top, left: 0, width: spot.left, height: spot.height }} />,
    <div key="r" className={cls} style={{ top: spot.top, left: spot.left + spot.width, width: Math.max(vw - (spot.left + spot.width), 0), height: spot.height }} />,
  ];
  return (
    <>
      {parts}
      <div
        className="fixed z-[9998] pointer-events-none rounded-lg ring-2 ring-primary/70 shadow-[0_0_0_9999px_transparent] transition-all duration-200"
        style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
      />
    </>
  );
}
