import { Link } from "@/components/app-link";
import { PageContainer, Hero, HeroMeta, SectionTitle } from "@/components/page";
import {
  useLedgerState,
  useLedgerActions,
  workspaceMetrics,
  domainMetrics,
  formatMoney,
  monthlyCashFlow,
  convert,
  budgetSpent,
  goalProgress,
  balanceOf,
  workspaceDisplayCurrency,
  domainDisplayCurrency,
} from "@/lib/ledger";
import type { CurrencyCode, LedgerState } from "@/lib/ledger";
import { ArrowUpRight, AlertTriangle, Calendar, Target } from "lucide-react";
import { ui } from "@/lib/ui-store";
import type { QuickKind } from "@/components/quick-create";

export default function Home() {
  const state = useLedgerState();
  const ws = workspaceMetrics(state);
  // "personal" is the id the app gives the built-in personal workspace; fall
  // back to any personal-kind domain (e.g. an imported one).
  const personalDomain =
    state.domains.find((d) => d.id === "personal") ??
    state.domains.find((d) => d.kind === "personal");
  const businessDomains = state.domains.filter((d) => d.id !== personalDomain?.id);

  // Newest first by transaction DATE (state order is insertion order, so a
  // back-dated entry used to show up as the "latest"), and skip any
  // transaction with no entries instead of crashing on entries[0].
  const recent = [...state.transactions]
    .filter((t) => t.entries.length > 0)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8);

  // Reporting currency for the whole workspace — Settings → General →
  // "default currency" (see Settings.tsx). Every aggregate selector
  // (workspaceMetrics, domainMetrics, etc.) returns USD-normalised
  // numbers, so convert once here and format in the user's chosen
  // currency, same as Reports.tsx and DomainWorkspace already do. This
  // used to be hardcoded to NGN regardless of that setting.
  const wdc = workspaceDisplayCurrency(state);
  const disp = (usd: number) =>
    formatMoney(convert(state, usd, "USD", wdc), wdc, { compact: true });

  return (
    <PageContainer>
      <Hero
        eyebrow="Workspace"
        title="Your financial position"
        value={disp(ws.netWorth)}
        valueTone={ws.netWorth < 0 ? "neg" : "default"}
        valueHint={`Consolidated net worth · ${wdc}`}
        meta={
          <>
            <HeroMeta label="Assets" value={disp(ws.assets)} />
            <HeroMeta label="Liabilities" value={disp(ws.liabilities)} tone="neg" />
            <HeroMeta label="Liquid" value={disp(ws.liquid)} />
            <HeroMeta label="Available" value={disp(ws.cashAvailable)} />
            <HeroMeta label="Businesses" value={<span className="num">{ws.businesses}</span>} />
          </>
        }
      />

      <div className="grid grid-cols-12 gap-10">
        {/* Domain summary */}
        <section className="col-span-12 lg:col-span-8">
          <SectionTitle>Domain Summary</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {personalDomain && <DomainCard domainId={personalDomain.id} />}
            {businessDomains.map((d) => (
              <DomainCard key={d.id} domainId={d.id} />
            ))}
          </div>

          <div className="mt-10">
            <SectionTitle>Recent Activity</SectionTitle>
            <div className="border border-border rounded-lg bg-card divide-y divide-border overflow-hidden">
              {recent.map((t) => {
                const first = t.entries[0];
                const obj = state.objects.find((o) => o.id === first.objectId);
                const domain = state.domains.find((d) => d.id === obj?.domainId);
                const voided = t.status === "void";
                return (
                  <Link
                    key={t.id}
                    to={`/transactions/${t.id}`}
                    className={[
                      "flex items-center gap-4 px-4 py-2.5 text-sm hover:bg-accent/50 transition-colors",
                      voided ? "opacity-50" : "",
                    ].join(" ")}
                  >
                    <span className="num text-xs text-muted-foreground w-14">
                      {new Date(t.date).toLocaleDateString("en-US", {
                        month: "short",
                        day: "2-digit",
                      })}
                    </span>
                    <span className={["flex-1 truncate", voided ? "line-through" : ""].join(" ")}>
                      {t.description}
                    </span>
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground w-24 truncate">
                      {domain?.name}
                    </span>
                    <span
                      className={[
                        "num text-sm w-28 text-right",
                        voided
                          ? ""
                          : first.amount > 0
                            ? "text-pos"
                            : first.amount < 0
                              ? "text-neg"
                              : "",
                      ].join(" ")}
                    >
                      {obj ? formatMoney(first.amount, obj.currency) : first.amount}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>

        {/* Upcoming + Quick Actions */}
        <aside className="col-span-12 lg:col-span-4 space-y-10">
          <div>
            <SectionTitle>Upcoming</SectionTitle>
            <ul className="space-y-3">
              {deriveUpcoming(state).map((u, i) => (
                <UpcomingRow
                  key={i}
                  icon={u.icon}
                  label={u.label}
                  detail={u.detail}
                  amount={u.amount}
                  tone={u.tone}
                />
              ))}
            </ul>
          </div>

          <div>
            <SectionTitle>Quick Actions</SectionTitle>
            <div className="grid grid-cols-1 gap-2">
              <QuickAction kind="transaction" label="New Transaction" />
              <QuickAction kind="transfer" label="New Transfer" />
              <QuickAction kind="business" label="New Business" />
            </div>
          </div>
        </aside>
      </div>
    </PageContainer>
  );
}

function DomainCard({ domainId }: { domainId: string }) {
  const state = useLedgerState();
  const domain = state.domains.find((d) => d.id === domainId);
  if (!domain) return null;
  const m = domainMetrics(state, domainId);
  const cash = monthlyCashFlow(state, domainId).slice(-6);
  const to = domainId === "personal" ? "/personal" : `/businesses/${domainId}`;
  // This domain's own reporting currency — its Domain Settings override
  // if it has one, else the workspace default (see domainDisplayCurrency
  // and domain-workspace.tsx, which already respects this correctly).
  const ddc = domainDisplayCurrency(state, domainId);
  const disp = (usd: number) =>
    formatMoney(convert(state, usd, "USD", ddc), ddc, { compact: true });
  return (
    <Link
      to={to}
      className="group border border-border rounded-lg bg-card p-4 hover:border-foreground/20 transition-colors"
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {domain.kind}
          </div>
          <div className="font-medium">{domain.name}</div>
        </div>
        <ArrowUpRight className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <MiniStat label="Net Worth" value={disp(m.netWorth)} />
        <MiniStat
          label={
            domainId === "trading" ? "Portfolio" : domain.kind === "business" ? "Cash" : "Liquid"
          }
          value={disp(m.liquid)}
        />
        <MiniStat label="Flow" value={<Sparkline data={cash.map((c) => c.net)} />} />
      </div>
    </Link>
  );
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="num text-sm font-medium mt-0.5">{value}</div>
    </div>
  );
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return <span className="text-muted-foreground text-xs">—</span>;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 60,
    h = 20;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} className="text-primary" aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}

function UpcomingRow({
  icon: Icon,
  label,
  detail,
  amount,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  detail: string;
  amount: string;
  tone?: "neg";
}) {
  return (
    <li className="flex items-center gap-3">
      <div className="size-8 rounded-md bg-muted grid place-items-center">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{label}</div>
        <div className="text-xs text-muted-foreground">{detail}</div>
      </div>
      <div className={["num text-sm", tone === "neg" ? "text-neg" : ""].join(" ")}>{amount}</div>
    </li>
  );
}

/** Opens the real dialog. These used to be links to list pages, so
 *  "New Transfer" just landed on the Accounts tab. */
function QuickAction({ kind, label }: { kind: QuickKind; label: string }) {
  return (
    <button
      type="button"
      onClick={() => ui.openQuickCreate(kind)}
      className="text-sm border border-border rounded-md px-3 py-2 hover:bg-accent transition-colors flex items-center justify-between text-left"
    >
      {label}
      <ArrowUpRight className="size-3.5 text-muted-foreground" />
    </button>
  );
}

type UpcomingItem = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  detail: string;
  amount: string;
  tone?: "neg";
  sort: number; // days from today; smaller = sooner
};

function deriveUpcoming(state: LedgerState): UpcomingItem[] {
  const today = new Date();
  const items: UpcomingItem[] = [];

  // Loan / credit card due dates from object metadata
  for (const o of state.objects) {
    if (o.dueDay == null) continue;
    const next = nextOccurrence(today, o.dueDay);
    const days = daysUntil(today, next);
    const owed = -balanceOf(state, o.id); // balances are signed; negative = owed
    if (o.kind === "loan" || o.kind === "mortgage") {
      const min = o.minPayment ?? owed;
      if (min > 0 && owed > 0) {
        items.push({
          icon: AlertTriangle,
          label: `${o.name} repayment`,
          detail: `Due ${fmtDate(next)}`,
          amount: formatMoney(min, o.currency),
          tone: "neg",
          sort: days,
        });
      }
    } else if (o.kind === "credit_card") {
      if (owed > 0) {
        items.push({
          icon: AlertTriangle,
          label: `${o.name} statement`,
          detail: `Due ${fmtDate(next)}`,
          amount: formatMoney(owed, o.currency),
          tone: "neg",
          sort: days,
        });
      }
    }
  }

  // Recurring rent — infer next occurrence from the most recent rent expense
  const rentCats = new Set(
    state.categories.filter((c) => c.name.trim().toLowerCase() === "rent").map((c) => c.id),
  );
  const rents = state.transactions
    .filter(
      (t) =>
        t.status !== "void" && t.entries.some((e) => e.categoryId && rentCats.has(e.categoryId)),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  if (rents.length > 0) {
    const last = rents[0];
    const lastEntry = last.entries.find((e) => e.categoryId && rentCats.has(e.categoryId));
    const obj = state.objects.find((o) => o.id === lastEntry?.objectId);
    if (obj && lastEntry) {
      const d = new Date(last.date);
      const next = new Date(
        Date.UTC(
          d.getUTCFullYear(),
          d.getUTCMonth() + 1,
          clampDay(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()),
        ),
      );
      const days = daysUntil(startOfUtcDay(today), next);
      // Overdue used to vanish (days < 0 was dropped): rent disappeared from
      // the list exactly when it was late.
      if (days >= -31) {
        items.push({
          icon: Calendar,
          label: days < 0 ? "Rent (overdue)" : "Rent",
          detail: days < 0 ? `Was due ${fmtDate(next)}` : `Due ${fmtDate(next)}`,
          amount: formatMoney(Math.abs(lastEntry.amount), obj.currency),
          tone: "neg",
          sort: days,
        });
      }
    }
  }

  // Budget lines close to or over their cap for the current month
  const ym = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`;
  for (const b of state.budgets) {
    if (b.month !== ym) continue;
    for (const line of b.lines) {
      const spent = budgetSpent(state, b.id, line.categoryId);
      const pct = line.amount > 0 ? spent / line.amount : 0;
      if (pct >= 0.8) {
        const cat = state.categories.find((c) => c.id === line.categoryId);
        items.push({
          icon: AlertTriangle,
          label: `${cat?.name ?? "Budget"} · ${Math.round(pct * 100)}%`,
          detail: monthLabel(b.month),
          amount: `${formatMoney(spent, b.currency as CurrencyCode)} / ${formatMoney(line.amount, b.currency as CurrencyCode)}`,
          tone: pct >= 1 ? "neg" : undefined,
          sort: 15,
        });
      }
    }
  }

  // Nearest goal deadline
  const upcomingGoal = [...state.goals]
    .filter((g) => new Date(g.deadline).getTime() > today.getTime())
    .sort((a, b) => a.deadline.localeCompare(b.deadline))[0];
  if (upcomingGoal) {
    const { pct } = goalProgress(state, upcomingGoal.id);
    const dl = new Date(upcomingGoal.deadline);
    items.push({
      icon: Target,
      label: `${upcomingGoal.name} · deadline`,
      detail: dl.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      amount: `${Math.round(pct * 100)}% funded`,
      sort: daysUntil(today, dl),
    });
  }

  return items.sort((a, b) => a.sort - b.sort).slice(0, 4);
}

/** Last valid day of `month` (0-based): a due day of 31 in a 30-day month
 *  used to roll over into the next month. */
function clampDay(year: number, month: number, day: number): number {
  return Math.min(day, new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function nextOccurrence(from: Date, dueDay: number): Date {
  const start = startOfUtcDay(from); // "due today" is upcoming, not already past
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth();
  const thisMonth = new Date(Date.UTC(y, m, clampDay(y, m, dueDay)));
  if (thisMonth.getTime() >= start.getTime()) return thisMonth;
  const ny = m === 11 ? y + 1 : y;
  const nm = (m + 1) % 12;
  return new Date(Date.UTC(ny, nm, clampDay(ny, nm, dueDay)));
}

function daysUntil(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long" });
}
