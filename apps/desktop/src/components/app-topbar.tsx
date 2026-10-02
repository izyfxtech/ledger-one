import { useRouterState } from "@tanstack/react-router";
import { Link } from "@/components/app-link";
import { useQuery } from "@tanstack/react-query";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useSelector } from "@tanstack/react-store";
import {
  Search,
  Plus,
  Menu,
  Sun,
  Moon,
  Monitor,
  Check,
  ChevronDown,
  Briefcase,
  User,
} from "lucide-react";
import { canPerform } from "@/lib/local-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CommandPalette } from "./command-palette";
import type { QuickKind } from "./quick-create";
import { DEFAULT_SETTINGS, useLedgerActions, useLedgerState } from "@/lib/ledger";
import { usersQuery } from "@/lib/app-queries";
import { ui, uiStore } from "@/lib/ui-store";
import { SyncStatus } from "./sync-status";

/** Extract active domain id from pathname; null when on Home/Reports/Settings. */
function activeDomainId(pathname: string): string | null {
  if (pathname === "/personal" || pathname.startsWith("/personal/")) return "personal";
  const m = pathname.match(/^\/businesses\/([^/]+)(?:\/|$)/);
  return m ? m[1] : null;
}

export function AppTopbar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const state = useLedgerState();
  useQuery(usersQuery); // re-render when the active user/role changes
  const canWrite = canPerform("write");
  const activeId = activeDomainId(pathname);
  const activeDomain = activeId ? state.domains.find((d) => d.id === activeId) : null;

  useHotkey("Mod+K", () => ui.togglePalette());
  // "T" = new transaction (the menu advertises it). Single-key hotkeys ignore
  // text inputs by default; also hold off while a dialog or the palette is open.
  const overlayOpen = useSelector(uiStore, (st) => st.quickKind !== null || st.paletteOpen);
  useHotkey("T", () => ui.openQuickCreate("transaction", activeId), {
    enabled: canWrite && !overlayOpen,
  });

  const options: { kind: QuickKind; label: string; hint?: string }[] = [
    { kind: "transaction", label: "Transaction", hint: "T" },
    { kind: "transfer", label: "Transfer" },
    { kind: "account", label: "Account" },
    { kind: "liability", label: "Liability" },
    { kind: "allocation", label: "Allocation" },
    { kind: "goal", label: "Goal" },
    { kind: "business", label: "Business" },
    { kind: "budget", label: "Budget" },
  ];

  const businesses = state.domains.filter((d) => d.id !== "personal");

  return (
    <header className="h-14 sticky top-0 z-30 bg-background/85 backdrop-blur border-b border-border flex items-center gap-3 px-3 sm:px-4">
      <button
        type="button"
        onClick={() => ui.setMobileNav(true)}
        aria-label="Open sidebar"
        className="md:hidden size-8 grid place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
      >
        <Menu className="size-4" />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            data-tour="domain-switcher"
            className={[
              "h-8 rounded-md border border-border bg-card px-2.5 pr-2 inline-flex items-center gap-2 text-sm hover:border-foreground/20 transition-colors",
            ].join(" ")}
          >
            {activeDomain ? (
              activeDomain.id === "personal" ? (
                <User className="size-3.5 text-muted-foreground" />
              ) : (
                <Briefcase className="size-3.5 text-muted-foreground" />
              )
            ) : (
              <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Workspace
              </span>
            )}
            <span className="font-medium max-w-[10rem] truncate">
              {activeDomain ? activeDomain.name : "All ledgers"}
            </span>
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Switch ledger
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/" className="flex items-center gap-2">
              <span className="size-3.5 rounded-full border border-border shrink-0" />
              <span className="flex-1">Workspace overview</span>
              {!activeDomain && <Check className="size-3.5" />}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/personal" className="flex items-center gap-2">
              <User className="size-3.5 text-muted-foreground" />
              <span className="flex-1">Personal</span>
              {activeId === "personal" && <Check className="size-3.5" />}
            </Link>
          </DropdownMenuItem>
          {businesses.length > 0 && <DropdownMenuSeparator />}
          {businesses.map((d) => (
            <DropdownMenuItem key={d.id} asChild>
              <Link to={`/businesses/${d.id}`} className="flex items-center gap-2">
                <Briefcase className="size-3.5 text-muted-foreground" />
                <span className="flex-1 truncate">{d.name}</span>
                {activeId === d.id && <Check className="size-3.5" />}
              </Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/businesses" className="text-muted-foreground text-xs">
              Manage businesses →
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        onClick={() => ui.setPalette(true)}
        data-tour="search"
        className="group flex-1 max-w-md flex items-center gap-2 h-8 rounded-md border border-border bg-card px-3 text-left text-sm text-muted-foreground hover:border-foreground/20 transition-colors"
      >
        <Search className="size-3.5" />
        <span>Search everything…</span>
        <kbd className="ml-auto text-[10px] font-mono border border-border rounded px-1.5 py-0.5 group-hover:border-foreground/20">
          ⌘K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-2">
        <SyncStatus />
        <ThemeToggle />
        {canWrite && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                data-tour="new"
                className="h-8 px-3 rounded-md bg-ink text-paper text-sm font-medium inline-flex items-center gap-1.5 hover:opacity-90 transition-opacity"
              >
                <Plus className="size-4" strokeWidth={2.4} />
                New
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Quick create
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {options.map((o) => (
                <DropdownMenuItem
                  key={o.kind}
                  onSelect={() => ui.openQuickCreate(o.kind, activeId)}
                >
                  {o.label}
                  {o.hint && (
                    <kbd className="ml-auto text-[10px] font-mono border border-border rounded px-1 py-0.5">
                      {o.hint}
                    </kbd>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <CommandPalette />
    </header>
  );
}

function ThemeToggle() {
  const state = useLedgerState();
  const { updateSettings } = useLedgerActions();
  const theme = state.settings?.theme ?? DEFAULT_SETTINGS.theme;
  const Icon = theme === "dark" ? Moon : theme === "system" ? Monitor : Sun;
  const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  const label =
    theme === "light" ? "Light theme" : theme === "dark" ? "Dark theme" : "System theme";
  return (
    <button
      type="button"
      aria-label={`Theme: ${label}. Click to switch to ${next}.`}
      title={`${label} · click for ${next}`}
      onClick={() => updateSettings({ theme: next })}
      data-tour="theme"
      className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
    >
      <Icon className="size-4" />
    </button>
  );
}
