import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Home,
  Briefcase,
  BarChart3,
  Settings,
  BookOpen,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  Wallet,
  CreditCard,
  ArrowLeftRight,
  PieChart,
  CircleDot,
  Target,
  Tag,
  LineChart,
  ChevronLeft,
} from "lucide-react";
import { useSidebarShell } from "./sidebar-shell";
import { loadDisplayName } from "@/lib/local-store";
import { useLedger } from "@/lib/ledger";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Item = { to: string; label: string; icon: React.ComponentType<{ className?: string }> };

const workspaceNav: Item[] = [
  { to: "/", label: "Home", icon: Home },
  { to: "/businesses", label: "Businesses", icon: Briefcase },
];

const workspaceSecondary: Item[] = [
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
];

const DOMAIN_TABS: Array<{ slug: string; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { slug: "", label: "Overview", icon: CircleDot },
  { slug: "accounts", label: "Accounts", icon: Wallet },
  { slug: "liabilities", label: "Liabilities", icon: CreditCard },
  { slug: "transactions", label: "Transactions", icon: ArrowLeftRight },
  { slug: "budget", label: "Budget", icon: PieChart },
  { slug: "allocations", label: "Allocations", icon: PieChart },
  { slug: "goals", label: "Goals", icon: Target },
  { slug: "categories", label: "Categories", icon: Tag },
  { slug: "analytics", label: "Analytics", icon: LineChart },
  { slug: "settings", label: "Settings", icon: Settings },
];

/**
 * Given a pathname, return the active domain basePath ("/personal" or
 * "/businesses/:domain") if we're inside a domain workspace — else null.
 * `/businesses` (the index) is NOT a domain workspace, so it returns null
 * and the workspace nav shows instead.
 */
function activeDomainBase(pathname: string): { base: string; id: string } | null {
  if (pathname === "/personal" || pathname.startsWith("/personal/")) {
    return { base: "/personal", id: "personal" };
  }
  const m = pathname.match(/^\/businesses\/([^/]+)(?:\/|$)/);
  if (m) return { base: `/businesses/${m[1]}`, id: m[1] };
  return null;
}

export function AppSidebar() {
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useSidebarShell();
  const [name, setName] = useState<string>(() => loadDisplayName());
  const { pathname } = useLocation();
  const { state } = useLedger();
  const active = useMemo(() => activeDomainBase(pathname), [pathname]);
  const domain = active ? state.domains.find((d) => d.id === active.id) : null;

  useEffect(() => {
    const on = () => setName(loadDisplayName());
    window.addEventListener("ledgerone:display-name-changed", on);
    return () => window.removeEventListener("ledgerone:display-name-changed", on);
  }, []);

  return (
    <>
      <div
        onClick={() => setMobileOpen(false)}
        aria-hidden
        className={[
          "md:hidden fixed inset-0 z-40 bg-ink/40 backdrop-blur-sm transition-opacity duration-200",
          mobileOpen ? "opacity-100" : "opacity-0 pointer-events-none",
        ].join(" ")}
      />

      <aside
        aria-label="Primary"
        className={[
          "z-50 shrink-0 flex-col border-r border-border bg-sidebar",
          "transition-[width,transform] duration-300 ease-out will-change-[width,transform]",
          "fixed inset-y-0 left-0 flex w-64",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          "md:sticky md:top-0 md:h-screen md:translate-x-0 md:flex",
          collapsed ? "md:w-14" : "md:w-60",
        ].join(" ")}
      >
        <div className="h-14 flex items-center gap-2 px-3 border-b border-border">
          <Link to="/" className="size-6 rounded-sm bg-ink flex items-center justify-center shrink-0" aria-label="LedgerOne home">
            <BookOpen className="size-3.5 text-paper" strokeWidth={2.5} />
          </Link>
          <span
            className={[
              "display text-[1.05rem] tracking-tight overflow-hidden whitespace-nowrap transition-[opacity,margin] duration-200",
              collapsed ? "md:opacity-0 md:-ml-2 md:w-0" : "opacity-100",
            ].join(" ")}
          >
            LedgerOne
          </span>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close sidebar"
            className="md:hidden ml-auto size-7 grid place-items-center rounded-md hover:bg-sidebar-accent transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <TooltipProvider delayDuration={100}>
          <nav className="flex-1 flex flex-col px-2 py-4 gap-2 text-sm overflow-y-auto">
            {active && domain ? (
              <DomainNav
                base={active.base}
                domainName={domain.name}
                domainKind={domain.kind}
                collapsed={collapsed}
              />
            ) : (
              <>
                <NavGroup items={workspaceNav} collapsed={collapsed} personal />
                <div className="border-t border-border mx-2 my-3" />
                <NavGroup items={workspaceSecondary} collapsed={collapsed} />
              </>
            )}
          </nav>
        </TooltipProvider>

        <div className="px-3 py-3 border-t border-border flex items-center gap-2" data-tour="user-badge">
          <div className="size-7 rounded-full bg-primary/15 text-primary grid place-items-center text-xs font-semibold shrink-0">
            {(name.trim()[0] ?? "A").toUpperCase()}
          </div>
          <div
            className={[
              "text-xs leading-tight overflow-hidden whitespace-nowrap transition-[opacity,width] duration-200",
              collapsed ? "md:opacity-0 md:w-0" : "opacity-100",
            ].join(" ")}
          >
            <div className="font-medium">{name.trim() || "Workspace"}</div>
            <div className="text-muted-foreground">local · offline</div>
          </div>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden md:grid ml-auto size-7 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors"
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </button>
        </div>
      </aside>
    </>
  );
}

/**
 * Domain-scoped nav: when the user is inside /personal or /businesses/:domain,
 * the sidebar becomes the domain's own tab list — accounts, liabilities,
 * transactions, budget, etc. This is what makes those tabs feel primary
 * instead of nested-tabs-inside-tabs.
 */
function DomainNav({
  base,
  domainName,
  domainKind,
  collapsed,
}: {
  base: string;
  domainName: string;
  domainKind: string;
  collapsed: boolean;
}) {
  const { pathname } = useLocation();
  const isPersonal = base === "/personal";
  const backTo = isPersonal ? "/" : "/businesses";
  const backLabel = isPersonal ? "Workspace" : "All businesses";
  return (
    <>
      <Link
        to={backTo}
        className={[
          "group flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors",
        ].join(" ")}
      >
        <ChevronLeft className="size-3.5 shrink-0" />
        <span
          className={[
            "overflow-hidden whitespace-nowrap transition-[opacity,width] duration-200",
            collapsed ? "md:opacity-0 md:w-0" : "opacity-100",
          ].join(" ")}
        >
          {backLabel}
        </span>
      </Link>

      <div
        className={[
          "px-2.5 pt-2 pb-3 overflow-hidden transition-[opacity,height] duration-200",
          collapsed ? "md:opacity-0 md:h-0 md:pt-0 md:pb-0" : "opacity-100",
        ].join(" ")}
      >
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{domainKind}</div>
        <div className="display text-base leading-tight truncate">{domainName}</div>
      </div>

      <ul className="flex flex-col gap-0.5">
        {DOMAIN_TABS.map((t) => {
          const to = base + (t.slug ? `/${t.slug}` : "");
          const active =
            t.slug === ""
              ? pathname === base
              : pathname === to || pathname.startsWith(to + "/");
          const Icon = t.icon;
          const link = (
            <Link
              to={to}
              data-tab={t.slug || "overview"}
              className={[
                "group relative flex items-center gap-2.5 px-2.5 py-2 rounded-md transition-all duration-200",
                "hover:translate-x-[1px]",
                active
                  ? "bg-sidebar-accent text-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
              ].join(" ")}
            >
              <span
                aria-hidden
                className={[
                  "absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary transition-all duration-200",
                  active ? "opacity-100 scale-y-100" : "opacity-0 scale-y-50",
                ].join(" ")}
              />
              <Icon className="size-4 shrink-0" />
              <span
                className={[
                  "overflow-hidden whitespace-nowrap transition-[opacity,width] duration-200",
                  collapsed ? "md:opacity-0 md:w-0" : "opacity-100",
                ].join(" ")}
              >
                {t.label}
              </span>
            </Link>
          );
          return (
            <li key={t.slug || "overview"}>
              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>{t.label}</TooltipContent>
                </Tooltip>
              ) : (
                link
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function NavGroup({ items, collapsed, personal }: { items: Item[]; collapsed: boolean; personal?: boolean }) {
  const { pathname } = useLocation();
  const { state } = useLedger();
  const personalDomain = personal ? state.domains.find((d) => d.id === "personal") : null;
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((it) => {
        const active = it.to === "/" ? pathname === "/" : pathname.startsWith(it.to);
        const Icon = it.icon;
        const link = (
          <Link
            to={it.to}
            data-tour={`nav-${it.to.replace(/\//g, "") || "home"}`}
            className={[
              "group relative flex items-center gap-2.5 px-2.5 py-2 rounded-md transition-all duration-200",
              "hover:translate-x-[1px]",
              active
                ? "bg-sidebar-accent text-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
            ].join(" ")}
          >
            <span
              aria-hidden
              className={[
                "absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary transition-all duration-200",
                active ? "opacity-100 scale-y-100" : "opacity-0 scale-y-50",
              ].join(" ")}
            />
            <Icon className="size-4 shrink-0" />
            <span
              className={[
                "overflow-hidden whitespace-nowrap transition-[opacity,width] duration-200",
                collapsed ? "md:opacity-0 md:w-0" : "opacity-100",
              ].join(" ")}
            >
              {it.label}
            </span>
          </Link>
        );
        return (
          <li key={it.to}>
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>{it.label}</TooltipContent>
              </Tooltip>
            ) : (
              link
            )}
          </li>
        );
      })}
      {personalDomain && (
        <li>
          <Link
            to="/personal"
            className={[
              "group relative flex items-center gap-2.5 px-2.5 py-2 rounded-md transition-all duration-200",
              "hover:translate-x-[1px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
            ].join(" ")}
          >
            <CircleDot className="size-4 shrink-0" />
            <span
              className={[
                "overflow-hidden whitespace-nowrap transition-[opacity,width] duration-200",
                collapsed ? "md:opacity-0 md:w-0" : "opacity-100",
              ].join(" ")}
            >
              Personal
            </span>
          </Link>
        </li>
      )}
    </ul>
  );
}
