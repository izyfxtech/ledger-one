import { useNavigate } from "@tanstack/react-router";
import { useSelector } from "@tanstack/react-store";
import { useHotkey } from "@tanstack/react-hotkeys";
import { Command } from "cmdk";
import { useLedgerState, formatMoney, balanceOf } from "@/lib/ledger";
import { domainBase } from "@/lib/paths";
import { ui, uiStore } from "@/lib/ui-store";
import { Search } from "lucide-react";

export function CommandPalette() {
  const state = useLedgerState();
  const open = useSelector(uiStore, (s) => s.paletteOpen);
  const q = useSelector(uiStore, (s) => s.paletteQuery);
  const navigate = useNavigate();

  // Esc was advertised by the badge below but never handled.
  useHotkey("Escape", () => ui.setPalette(false), { enabled: open });

  if (!open) return null;

  const query = q.trim().toLowerCase();
  const match = (name: string) => !query || name.toLowerCase().includes(query);
  const results = {
    accounts: state.objects.filter((o) => match(o.name)),
    allocations: state.allocations.filter((a) => match(a.name)),
    goals: state.goals.filter((g) => match(g.name)),
    domains: state.domains.filter((d) => match(d.name)),
    transactions: state.transactions.filter((t) => match(t.description)).slice(0, 8),
  };

  const go = (to: string) => {
    ui.setPalette(false);
    void navigate({ to: to as never });
  };
  const onOpenChange = ui.setPalette;
  const setQ = ui.setPaletteQuery;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-[10vh] px-4"
      onClick={() => onOpenChange(false)}
    >
      <Command
        className="w-full max-w-xl bg-popover text-popover-foreground rounded-lg border border-border shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        loop
      >
        <div className="flex items-center gap-2 px-4 border-b border-border">
          <Search className="size-4 text-muted-foreground" />
          <Command.Input
            autoFocus
            value={q}
            onValueChange={setQ}
            placeholder="Search accounts, transactions, allocations, goals…"
            className="w-full h-12 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
          />
          <kbd className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
            ESC
          </kbd>
        </div>
        <Command.List className="max-h-96 overflow-y-auto p-2">
          <Command.Empty className="py-8 text-center text-sm text-muted-foreground">
            Nothing found for "{q}"
          </Command.Empty>

          {results.domains.length > 0 && (
            <Command.Group
              heading="Domains"
              className="text-[10px] uppercase tracking-widest text-muted-foreground px-2 pt-2 pb-1"
            >
              {results.domains.map((d) => (
                <Command.Item
                  key={d.id}
                  value={`domain ${d.name}`}
                  onSelect={() => go(domainBase(d.id))}
                  className="flex items-center justify-between px-2 py-2 text-sm rounded-md cursor-pointer data-[selected=true]:bg-accent"
                >
                  <span className="text-foreground">{d.name}</span>
                  <span className="text-xs text-muted-foreground capitalize">{d.kind}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {results.accounts.length > 0 && (
            <Command.Group
              heading="Accounts & Liabilities"
              className="text-[10px] uppercase tracking-widest text-muted-foreground px-2 pt-2 pb-1"
            >
              {results.accounts.slice(0, 8).map((o) => {
                const bal = balanceOf(state, o.id);
                return (
                  <Command.Item
                    key={o.id}
                    value={`account ${o.name} ${o.institution ?? ""}`}
                    onSelect={() => go(`${domainBase(o.domainId)}/accounts/${o.id}`)}
                    className="flex items-center justify-between px-2 py-2 text-sm rounded-md cursor-pointer data-[selected=true]:bg-accent"
                  >
                    <div>
                      <div className="text-foreground">{o.name}</div>
                      <div className="text-xs text-muted-foreground">{o.institution ?? o.kind}</div>
                    </div>
                    <span className="num text-xs">
                      {formatMoney(bal, o.currency, { compact: true })}
                    </span>
                  </Command.Item>
                );
              })}
            </Command.Group>
          )}

          {results.transactions.length > 0 && (
            <Command.Group
              heading="Transactions"
              className="text-[10px] uppercase tracking-widest text-muted-foreground px-2 pt-2 pb-1"
            >
              {results.transactions.map((t) => (
                <Command.Item
                  key={t.id}
                  value={`transaction ${t.description}`}
                  onSelect={() => go(`/transactions/${t.id}`)}
                  className="flex items-center justify-between px-2 py-2 text-sm rounded-md cursor-pointer data-[selected=true]:bg-accent"
                >
                  <span>{t.description}</span>
                  <span className="text-xs text-muted-foreground num">
                    {new Date(t.date).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {results.allocations.length > 0 && (
            <Command.Group
              heading="Allocations"
              className="text-[10px] uppercase tracking-widest text-muted-foreground px-2 pt-2 pb-1"
            >
              {results.allocations.map((a) => (
                <Command.Item
                  key={a.id}
                  value={`allocation ${a.name}`}
                  onSelect={() => go(`${domainBase(a.domainId)}/allocations/${a.id}`)}
                  className="px-2 py-2 text-sm rounded-md cursor-pointer data-[selected=true]:bg-accent"
                >
                  {a.name}
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {results.goals.length > 0 && (
            <Command.Group
              heading="Goals"
              className="text-[10px] uppercase tracking-widest text-muted-foreground px-2 pt-2 pb-1"
            >
              {results.goals.map((g) => (
                <Command.Item
                  key={g.id}
                  value={`goal ${g.name}`}
                  onSelect={() => go(`${domainBase(g.domainId)}/goals/${g.id}`)}
                  className="px-2 py-2 text-sm rounded-md cursor-pointer data-[selected=true]:bg-accent"
                >
                  {g.name}
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </div>
  );
}
