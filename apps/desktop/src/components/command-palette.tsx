import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Command } from "cmdk";
import { useLedger, formatMoney, balanceOf } from "@/lib/ledger";
import { Search } from "lucide-react";

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { state } = useLedger();
  const [q, setQ] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    return {
      accounts: state.objects.filter((o) => !query || o.name.toLowerCase().includes(query)),
      allocations: state.allocations.filter((a) => !query || a.name.toLowerCase().includes(query)),
      goals: state.goals.filter((g) => !query || g.name.toLowerCase().includes(query)),
      categories: state.categories.filter((c) => !query || c.name.toLowerCase().includes(query)),
      domains: state.domains.filter((d) => !query || d.name.toLowerCase().includes(query)),
      transactions: state.transactions
        .filter((t) => !query || t.description.toLowerCase().includes(query))
        .slice(0, 8),
    };
  }, [q, state]);

  if (!open) return null;

  const go = (to: string) => {
    onOpenChange(false);
    setQ("");
    navigate(to);
  };

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
          <kbd className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">ESC</kbd>
        </div>
        <Command.List className="max-h-96 overflow-y-auto p-2">
          <Command.Empty className="py-8 text-center text-sm text-muted-foreground">
            Nothing found for "{q}"
          </Command.Empty>

          {results.domains.length > 0 && (
            <Command.Group heading="Domains" className="text-[10px] uppercase tracking-widest text-muted-foreground px-2 pt-2 pb-1">
              {results.domains.map((d) => (
                <Command.Item
                  key={d.id}
                  value={`domain ${d.name}`}
                  onSelect={() => go(d.id === "personal" ? "/personal" : `/businesses/${d.id}`)}
                  className="flex items-center justify-between px-2 py-2 text-sm rounded-md cursor-pointer data-[selected=true]:bg-accent"
                >
                  <span className="text-foreground">{d.name}</span>
                  <span className="text-xs text-muted-foreground capitalize">{d.kind}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {results.accounts.length > 0 && (
            <Command.Group heading="Accounts & Liabilities" className="text-[10px] uppercase tracking-widest text-muted-foreground px-2 pt-2 pb-1">
              {results.accounts.slice(0, 8).map((o) => {
                const bal = balanceOf(state, o.id);
                return (
                  <Command.Item
                    key={o.id}
                    value={`account ${o.name} ${o.institution ?? ""}`}
                    onSelect={() =>
                      go(
                        o.domainId === "personal"
                          ? `/personal/accounts/${o.id}`
                          : `/businesses/${o.domainId}/accounts/${o.id}`,
                      )
                    }
                    className="flex items-center justify-between px-2 py-2 text-sm rounded-md cursor-pointer data-[selected=true]:bg-accent"
                  >
                    <div>
                      <div className="text-foreground">{o.name}</div>
                      <div className="text-xs text-muted-foreground">{o.institution ?? o.kind}</div>
                    </div>
                    <span className="num text-xs">{formatMoney(bal, o.currency, { compact: true })}</span>
                  </Command.Item>
                );
              })}
            </Command.Group>
          )}

          {results.transactions.length > 0 && (
            <Command.Group heading="Transactions" className="text-[10px] uppercase tracking-widest text-muted-foreground px-2 pt-2 pb-1">
              {results.transactions.map((t) => (
                <Command.Item
                  key={t.id}
                  value={`transaction ${t.description}`}
                  onSelect={() => go(`/transactions/${t.id}`)}
                  className="flex items-center justify-between px-2 py-2 text-sm rounded-md cursor-pointer data-[selected=true]:bg-accent"
                >
                  <span>{t.description}</span>
                  <span className="text-xs text-muted-foreground num">
                    {new Date(t.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {results.allocations.length > 0 && (
            <Command.Group heading="Allocations" className="text-[10px] uppercase tracking-widest text-muted-foreground px-2 pt-2 pb-1">
              {results.allocations.map((a) => (
                <Command.Item
                  key={a.id}
                  value={`allocation ${a.name}`}
                  onSelect={() =>
                    go(
                      a.domainId === "personal"
                        ? `/personal/allocations/${a.id}`
                        : `/businesses/${a.domainId}/allocations/${a.id}`,
                    )
                  }
                  className="px-2 py-2 text-sm rounded-md cursor-pointer data-[selected=true]:bg-accent"
                >
                  {a.name}
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {results.goals.length > 0 && (
            <Command.Group heading="Goals" className="text-[10px] uppercase tracking-widest text-muted-foreground px-2 pt-2 pb-1">
              {results.goals.map((g) => (
                <Command.Item
                  key={g.id}
                  value={`goal ${g.name}`}
                  onSelect={() =>
                    go(
                      g.domainId === "personal"
                        ? `/personal/goals/${g.id}`
                        : `/businesses/${g.domainId}/goals/${g.id}`,
                    )
                  }
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
