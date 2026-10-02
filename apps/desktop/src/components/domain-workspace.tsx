import { useState } from "react";
import { Link } from "@/components/app-link";
import {
  useLedgerActions,
  useLedgerState,
  formatMoney,
  balanceOf,
  domainMetrics,
  monthlyCashFlow,
  isLiability,
  isLiquid,
  transactionsByDomain,
  allocationBalance,
  convert,
  allocationByAccount,
  goalProgress,
  budgetSpent,
  categoryAndDescendants,
  NON_FLOW_KINDS,
  domainDisplayCurrency,
} from "@/lib/ledger";
import { currentMonthLocal, nextMonth } from "@/lib/dates";
import { CategoriesPanel } from "./category-manager";
import type { CurrencyCode } from "@/lib/ledger";
import { PageContainer, Stat, SectionTitle, EmptyState, Hero, HeroMeta } from "./page";
import { Plus, Trash2 } from "lucide-react";
import type { QuickKind } from "./quick-create";
import { DataTable, type Col } from "./data-table";
import { useAppForm } from "./form-fields";
import { ui } from "@/lib/ui-store";
import type { FinancialObject, Transaction } from "@/lib/ledger";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Tooltip,
  XAxis,
  LineChart,
  Line,
  YAxis,
  CartesianGrid,
} from "recharts";

export const DOMAIN_TABS = [
  "overview",
  "accounts",
  "liabilities",
  "transactions",
  "budget",
  "allocations",
  "goals",
  "categories",
  "analytics",
  "settings",
] as const;
export type DomainTab = (typeof DOMAIN_TABS)[number];

export function DomainWorkspace({
  domainId,
  basePath,
  tab = "overview",
}: {
  domainId: string;
  basePath: string; // e.g. "/personal" or "/businesses/photography"
  tab?: DomainTab;
}) {
  const state = useLedgerState();
  const domain = state.domains.find((d) => d.id === domainId);
  if (!domain)
    return (
      <PageContainer>
        <EmptyState title="Domain not found" />
      </PageContainer>
    );

  const metrics = domainMetrics(state, domainId);

  const ddc = domainDisplayCurrency(state, domainId);
  const disp = (usd: number) =>
    formatMoney(convert(state, usd, "USD", ddc), ddc, { compact: true });

  return (
    <PageContainer>
      <Hero
        eyebrow={domain.kind}
        title={domain.name}
        value={disp(metrics.netWorth)}
        valueTone={metrics.netWorth < 0 ? "neg" : "default"}
        valueHint={`Net worth · ${ddc}`}
        meta={
          <>
            <HeroMeta label="Cash" value={disp(metrics.liquid)} />
            <HeroMeta label="Assets" value={disp(metrics.assets)} />
            <HeroMeta label="Liabilities" value={disp(metrics.liabilities)} tone="neg" />
          </>
        }
      />

      {tab === "overview" && (
        <OverviewTab domainId={domainId} basePath={basePath} metrics={metrics} />
      )}
      {tab === "accounts" && <AccountsTab domainId={domainId} basePath={basePath} />}
      {tab === "liabilities" && <LiabilitiesTab domainId={domainId} basePath={basePath} />}
      {tab === "transactions" && <TransactionsTab domainId={domainId} basePath={basePath} />}
      {tab === "budget" && <BudgetTab domainId={domainId} />}
      {tab === "allocations" && <AllocationsTab domainId={domainId} basePath={basePath} />}
      {tab === "goals" && <GoalsTab domainId={domainId} basePath={basePath} />}
      {tab === "categories" && <CategoriesPanel />}
      {tab === "analytics" && <AnalyticsTab domainId={domainId} />}
      {tab === "settings" && <DomainSettingsTab key={domainId} domainId={domainId} />}
    </PageContainer>
  );
}

/* ---------- Overview ---------- */
function OverviewTab({
  domainId,
  basePath,
  metrics,
}: {
  domainId: string;
  basePath: string;
  metrics: ReturnType<typeof domainMetrics>;
}) {
  const state = useLedgerState();
  const objs = state.objects.filter((o) => o.domainId === domainId);
  const accounts = objs.filter((o) => !isLiability(o));
  const liabs = objs.filter(isLiability);
  const txns = transactionsByDomain(state, domainId).slice(0, 10);
  const goals = state.goals.filter((g) => g.domainId === domainId);
  const allocs = state.allocations.filter((a) => a.domainId === domainId);
  const budget = state.budgets.find((b) => b.domainId === domainId);

  const ddc = domainDisplayCurrency(state, domainId);
  const disp = (usd: number) =>
    formatMoney(convert(state, usd, "USD", ddc), ddc, { compact: true });

  return (
    <>
      <div className="grid grid-cols-12 gap-10">
        <div className="col-span-12 lg:col-span-7 space-y-10">
          <div>
            <SectionTitle
              action={
                <Link
                  to={`${basePath}/accounts`}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  View all →
                </Link>
              }
            >
              Accounts
            </SectionTitle>
            {accounts.length === 0 ? (
              <EmptyState title="No accounts yet" />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {accounts.map((o) => (
                  <Link
                    key={o.id}
                    to={`${basePath}/accounts/${o.id}`}
                    className="border border-border rounded-lg bg-card p-3 hover:border-foreground/20 transition-colors"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{o.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {o.institution ?? o.kind}
                        </div>
                      </div>
                      <div className="num text-sm font-medium tabular-nums whitespace-nowrap">
                        {formatMoney(-balanceOf(state, o.id), o.currency, { compact: true })}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {liabs.length > 0 && (
            <div>
              <SectionTitle
                action={
                  <Link
                    to={`${basePath}/liabilities`}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    View all →
                  </Link>
                }
              >
                Liabilities
              </SectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {liabs.map((o) => (
                  <Link
                    key={o.id}
                    to={`${basePath}/liabilities/${o.id}`}
                    className="border border-border rounded-lg bg-card p-3 border-l-2 border-l-neg hover:border-foreground/20 transition-colors"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium">{o.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {o.dueDay ? `Due day ${o.dueDay}` : o.kind}
                        </div>
                      </div>
                      <div className="num text-sm font-medium text-neg whitespace-nowrap">
                        {formatMoney(balanceOf(state, o.id), o.currency, { compact: true })}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div>
            <SectionTitle
              action={
                <Link
                  to={`${basePath}/transactions`}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  View all →
                </Link>
              }
            >
              Recent Transactions
            </SectionTitle>
            <div className="border border-border rounded-lg bg-card divide-y divide-border">
              {txns.map((t) => {
                const first = t.entries[0];
                const obj = state.objects.find((o) => o.id === first.objectId);
                return (
                  <Link
                    key={t.id}
                    to={`/transactions/${t.id}`}
                    className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent/40"
                  >
                    <span className="num text-xs text-muted-foreground w-14">
                      {new Date(t.date).toLocaleDateString("en-US", {
                        month: "short",
                        day: "2-digit",
                      })}
                    </span>
                    <span className="flex-1 truncate">{t.description}</span>
                    <span
                      className={[
                        "num text-sm w-28 text-right",
                        first.amount > 0 ? "text-pos" : first.amount < 0 ? "text-neg" : "",
                      ].join(" ")}
                    >
                      {obj ? formatMoney(first.amount, obj.currency) : first.amount}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="col-span-12 lg:col-span-5 space-y-10">
          {budget && (
            <div>
              <SectionTitle
                action={
                  <Link
                    to={`${basePath}/budget`}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Open →
                  </Link>
                }
              >
                Budget · {budget.month}
              </SectionTitle>
              <div className="space-y-2.5">
                {budget.lines.slice(0, 4).map((line) => {
                  const spent = budgetSpent(state, budget.id, line.categoryId);
                  const pct = Math.min(1, spent / line.amount);
                  const cat = state.categories.find((c) => c.id === line.categoryId);
                  return (
                    <div key={line.categoryId}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span>{cat?.name}</span>
                        <span className="num text-muted-foreground">
                          {formatMoney(spent, budget.currency, { compact: true })} /{" "}
                          {formatMoney(line.amount, budget.currency, { compact: true })}
                        </span>
                      </div>
                      <div className="h-1 bg-muted rounded-full overflow-hidden">
                        <div
                          className={["h-full", pct > 0.9 ? "bg-neg" : "bg-foreground"].join(" ")}
                          style={{ width: `${pct * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {allocs.length > 0 && (
            <div>
              <SectionTitle
                action={
                  <Link
                    to={`${basePath}/allocations`}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Open →
                  </Link>
                }
              >
                Allocations
              </SectionTitle>
              <div className="space-y-2.5">
                {allocs.map((a) => {
                  const bal = allocationBalance(state, a.id);
                  const targetUsd = a.target
                    ? convert(state, a.target, a.targetCurrency, "USD")
                    : 0;
                  const pct = targetUsd > 0 ? Math.min(1, Math.abs(bal) / targetUsd) : 0;
                  return (
                    <div key={a.id}>
                      <div className="flex justify-between text-xs mb-1">
                        <span>{a.name}</span>
                        <span className="num text-muted-foreground">{disp(Math.abs(bal))}</span>
                      </div>
                      <div className="h-1 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${pct * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {goals.length > 0 && (
            <div>
              <SectionTitle
                action={
                  <Link
                    to={`${basePath}/goals`}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Open →
                  </Link>
                }
              >
                Goals
              </SectionTitle>
              <div className="space-y-3">
                {goals.map((g) => {
                  const { pct } = goalProgress(state, g.id);
                  return (
                    <Link
                      key={g.id}
                      to={`${basePath}/goals/${g.id}`}
                      className="block border border-border rounded-lg bg-card p-3 hover:border-foreground/20 transition-colors"
                    >
                      <div className="flex items-baseline justify-between mb-2">
                        <span className="text-sm font-medium">{g.name}</span>
                        <span className="num text-xs text-muted-foreground">
                          {Math.round(pct * 100)}%
                        </span>
                      </div>
                      <div className="h-1 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-foreground" style={{ width: `${pct * 100}%` }} />
                      </div>
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-2">
                        by{" "}
                        {new Date(g.deadline.slice(0, 10)).toLocaleDateString("en-US", {
                          month: "short",
                          year: "numeric",
                          timeZone: "UTC",
                        })}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

/* ---------- Column definitions (TanStack Table) ---------- */
type LedgerSnapshot = ReturnType<typeof useLedgerState>;

function accountColumns(state: LedgerSnapshot, basePath: string): Col<FinancialObject>[] {
  return [
    {
      id: "name",
      header: "Name",
      accessorFn: (o) => o.name,
      cell: ({ row: { original: o } }) => (
        <Link to={`${basePath}/accounts/${o.id}`} className="font-medium hover:underline">
          {o.name}
        </Link>
      ),
    },
    {
      id: "institution",
      header: "Institution",
      accessorFn: (o) => o.institution ?? "—",
      className: "text-muted-foreground",
    },
    {
      id: "kind",
      header: "Type",
      accessorFn: (o) => o.kind,
      className: "text-muted-foreground capitalize",
    },
    { id: "currency", header: "Currency", accessorFn: (o) => o.currency, className: "num text-xs" },
    {
      id: "balance",
      header: "Balance",
      accessorFn: (o) => balanceOf(state, o.id),
      cell: ({ row: { original: o }, getValue }) => formatMoney(getValue<number>(), o.currency),
      className: "num text-right",
    },
  ];
}

function transactionColumns(state: LedgerSnapshot, domainId: string): Col<Transaction>[] {
  // The entry that represents this transaction *in this domain*.
  const firstEntry = (t: Transaction) =>
    t.entries.find((e) => state.objects.find((o) => o.id === e.objectId)?.domainId === domainId) ??
    t.entries[0];
  const objOf = (t: Transaction) => state.objects.find((o) => o.id === firstEntry(t).objectId);

  return [
    {
      id: "date",
      header: "Date",
      accessorFn: (t) => t.date,
      cell: ({ getValue }) =>
        new Date(getValue<string>()).toLocaleDateString("en-US", {
          month: "short",
          day: "2-digit",
        }),
      className: "num text-xs text-muted-foreground w-24",
    },
    {
      id: "description",
      header: "Description",
      accessorFn: (t) => t.description,
      cell: ({ row: { original: t } }) => (
        <>
          <Link
            to={`/transactions/${t.id}`}
            className={[
              "font-medium hover:underline",
              t.status === "void" ? "line-through" : "",
            ].join(" ")}
          >
            {t.description}
          </Link>
          {t.entries.length > 1 && (
            <span className="ml-2 text-[10px] text-muted-foreground">
              ·{t.entries.length} entries
            </span>
          )}
        </>
      ),
    },
    {
      id: "account",
      header: "Account",
      accessorFn: (t) => objOf(t)?.name ?? "—",
      className: "text-muted-foreground",
    },
    {
      id: "category",
      header: "Category",
      accessorFn: (t) =>
        state.categories.find((c) => c.id === firstEntry(t).categoryId)?.name ?? "—",
      className: "text-muted-foreground",
    },
    {
      id: "status",
      header: "Status",
      accessorFn: (t) => t.status ?? "cleared",
      className: "text-muted-foreground text-xs capitalize",
    },
    {
      id: "amount",
      header: "Amount",
      accessorFn: (t) => firstEntry(t).amount,
      cell: ({ row: { original: t }, getValue }) => {
        const amt = getValue<number>();
        const obj = objOf(t);
        const tone = t.status === "void" ? "" : amt > 0 ? "text-pos" : amt < 0 ? "text-neg" : "";
        return <span className={tone}>{obj ? formatMoney(amt, obj.currency) : amt}</span>;
      },
      className: "num text-right",
    },
  ];
}

type BudgetRow = {
  categoryId: string;
  cat?: { name: string };
  amount: number;
  spent: number;
  remaining: number;
  variance: number;
};

function budgetColumns(currency: CurrencyCode): Col<BudgetRow>[] {
  const money = (n: number, o?: { signed?: boolean }) =>
    formatMoney(n, currency, { compact: true, ...o });
  return [
    {
      id: "cat",
      header: "Category",
      accessorFn: (l) => l.cat?.name ?? "",
      className: "font-medium",
    },
    {
      id: "amount",
      header: "Budget",
      accessorFn: (l) => l.amount,
      cell: ({ getValue }) => money(getValue<number>()),
      className: "num text-right",
    },
    {
      id: "spent",
      header: "Spent",
      accessorFn: (l) => l.spent,
      cell: ({ row: { original: l }, getValue }) => (
        <span className={l.spent > l.amount ? "text-neg" : ""}>{money(getValue<number>())}</span>
      ),
      className: "num text-right",
    },
    {
      id: "remaining",
      header: "Remaining",
      accessorFn: (l) => l.remaining,
      cell: ({ getValue }) => money(Math.max(0, getValue<number>())),
      className: "num text-right",
    },
    {
      id: "variance",
      header: "Variance",
      accessorFn: (l) => l.variance,
      cell: ({ row: { original: l }, getValue }) => (
        <span className={l.spent > l.amount ? "text-neg" : "text-muted-foreground"}>
          {money(getValue<number>(), { signed: true })}
        </span>
      ),
      className: "num text-right",
    },
    {
      id: "progress",
      header: "Progress",
      enableSorting: false,
      className: "w-40",
      cell: ({ row: { original: l } }) => {
        const pct = l.amount > 0 ? Math.min(1, l.spent / l.amount) : 0; // zero-amount lines no longer NaN
        const hot = l.spent > l.amount || pct > 0.9;
        return (
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={["h-full", hot ? "bg-neg" : "bg-foreground"].join(" ")}
              style={{ width: `${pct * 100}%` }}
            />
          </div>
        );
      },
    },
  ];
}

/* ---------- Accounts ---------- */
function AccountsTab({ domainId, basePath }: { domainId: string; basePath: string }) {
  const state = useLedgerState();
  const accounts = state.objects.filter((o) => o.domainId === domainId && !isLiability(o));
  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <p className="text-sm text-muted-foreground">Where money physically exists.</p>
        <button
          type="button"
          onClick={() => openQuick("account", domainId)}
          className="text-sm border border-border rounded-md px-3 py-1.5 hover:bg-accent inline-flex items-center gap-1.5"
        >
          <Plus className="size-3.5" /> New Account
        </button>
      </div>
      <DataTable data={accounts} getRowId={(o) => o.id} columns={accountColumns(state, basePath)} />
    </>
  );
}

/* ---------- Liabilities ---------- */
function LiabilitiesTab({ domainId, basePath }: { domainId: string; basePath: string }) {
  const state = useLedgerState();
  const liabs = state.objects.filter((o) => o.domainId === domainId && isLiability(o));
  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <p className="text-sm text-muted-foreground">Manage obligations.</p>
        <button
          type="button"
          onClick={() => openQuick("liability", domainId)}
          className="text-sm border border-border rounded-md px-3 py-1.5 hover:bg-accent inline-flex items-center gap-1.5"
        >
          <Plus className="size-3.5" /> New Liability
        </button>
      </div>
      {liabs.length === 0 && (
        <EmptyState
          title="No liabilities"
          description="Loans, credit cards, and mortgages will appear here."
        />
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {liabs.map((o) => {
          const bal = balanceOf(state, o.id);
          return (
            <Link
              key={o.id}
              to={`${basePath}/liabilities/${o.id}`}
              className="border border-border rounded-lg bg-card p-4 border-l-2 border-l-neg hover:border-foreground/20 transition-colors"
            >
              <div className="flex justify-between items-baseline">
                <div>
                  <div className="font-medium">{o.name}</div>
                  <div className="text-xs text-muted-foreground">{o.institution}</div>
                </div>
                <div className="num text-lg text-neg">
                  {formatMoney(-bal, o.currency, { compact: true })}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 mt-4 text-[11px]">
                <MiniLabel k="Interest" v={o.interestRate ? `${o.interestRate}%` : "—"} />
                <MiniLabel
                  k="Min Payment"
                  v={o.minPayment ? formatMoney(o.minPayment, o.currency, { compact: true }) : "—"}
                />
                <MiniLabel k="Next Due" v={o.dueDay ? `Day ${o.dueDay}` : "—"} />
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}

function MiniLabel({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{k}</div>
      <div className="num">{v}</div>
    </div>
  );
}

/* ---------- Transactions ---------- */
function TransactionsTab({ domainId, basePath }: { domainId: string; basePath: string }) {
  const state = useLedgerState();
  const txns = transactionsByDomain(state, domainId);

  return (
    <>
      <p className="text-sm text-muted-foreground mb-4">
        The complete ledger — every event is derivable from these rows.
      </p>
      <DataTable
        data={txns}
        getRowId={(t) => t.id}
        columns={transactionColumns(state, domainId)}
        rowClassName={(t) => (t.status === "void" ? "opacity-50" : "")}
        virtualize
      />
    </>
  );
}

/* ---------- Budget ---------- */
function BudgetTab({ domainId }: { domainId: string }) {
  const state = useLedgerState();
  const { addBudget, deleteBudget } = useLedgerActions();
  const budgets = state.budgets
    .filter((b) => b.domainId === domainId)
    .sort((x, y) => y.month.localeCompare(x.month));
  const [picked, setPicked] = useState<string | null>(null);
  // Was `budgets.find(domain)`: whichever one was stored first, whatever the
  // month. Now: the one you picked, else this month's, else the latest.
  const budget =
    budgets.find((b) => b.id === picked) ??
    budgets.find((b) => b.month === currentMonthLocal()) ??
    budgets[0];

  if (!budget)
    return (
      <EmptyState
        title="No budget for this domain"
        description="Plan spending for a month to see it here."
        action={
          <button
            type="button"
            onClick={() => openQuick("budget", domainId)}
            className="text-sm border border-border rounded-md px-3 py-1.5 hover:bg-accent"
          >
            New Budget
          </button>
        }
      />
    );

  const lineCats = new Set(budget.lines.map((l) => l.categoryId));
  // A line on a sub-category is a sub-limit inside its parent's line (the
  // parent's spend already includes it), so totals use top-level lines only.
  const isNested = (cid: string) =>
    budget.lines.some(
      (o) =>
        o.categoryId !== cid &&
        lineCats.has(o.categoryId) &&
        categoryAndDescendants(state, o.categoryId).has(cid),
    );
  const lines = budget.lines.map((l) => {
    const cat = state.categories.find((c) => c.id === l.categoryId);
    const spent = budgetSpent(state, budget.id, l.categoryId);
    return {
      ...l,
      cat: {
        name: cat ? (isNested(l.categoryId) ? `↳ ${cat.name}` : cat.name) : "(deleted category)",
      },
      spent,
      remaining: l.amount - spent,
      variance: spent - l.amount,
      nested: isNested(l.categoryId),
    };
  });
  const top = lines.filter((l) => !l.nested);
  const totalBudget = top.reduce((sum, l) => sum + l.amount, 0);
  const totalSpent = top.reduce((sum, l) => sum + l.spent, 0);
  const over = totalSpent > totalBudget;

  const copyForward = () => {
    const month = nextMonth(budget.month);
    if (budgets.some((b) => b.month === month))
      return void toast.error(`A budget for ${month} already exists`);
    try {
      const nb = addBudget({
        domainId,
        month,
        currency: budget.currency,
        lines: budget.lines.map((l) => ({ ...l })),
      });
      setPicked(nb.id);
      toast.success(`Copied to ${month}`);
    } catch {
      /* permission toast already shown */
    }
  };
  const remove = () => {
    if (!window.confirm(`Delete the ${budget.month} budget? Transactions are not affected.`))
      return;
    try {
      deleteBudget(budget.id);
      setPicked(null);
      toast.success("Budget deleted");
    } catch {
      /* permission toast already shown */
    }
  };
  const btn = "text-sm border border-border rounded-md px-3 py-1.5 hover:bg-accent";

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <div className="flex gap-3 items-center">
          <span className="text-sm text-muted-foreground">Month</span>
          <select
            aria-label="Budget month"
            value={budget.id}
            onChange={(e) => setPicked(e.target.value)}
            className="text-sm border border-border rounded-md px-3 py-1.5 num bg-background"
          >
            {budgets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.month}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={copyForward} className={btn}>
            Copy to next month
          </button>
          <button type="button" onClick={remove} className={btn + " text-destructive"}>
            Delete
          </button>
          <button type="button" onClick={() => openQuick("budget", domainId)} className={btn}>
            New Budget
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-8 pb-8 border-b border-border mb-8">
        <Stat label="Budget" value={formatMoney(totalBudget, budget.currency, { compact: true })} />
        <Stat
          label="Spent"
          value={formatMoney(totalSpent, budget.currency, { compact: true })}
          tone={over ? "neg" : "default"}
        />
        <Stat
          label={over ? "Over by" : "Remaining"}
          value={formatMoney(Math.abs(totalBudget - totalSpent), budget.currency, {
            compact: true,
          })}
          tone={over ? "neg" : "default"}
        />
      </div>

      <DataTable
        data={lines}
        getRowId={(l) => l.categoryId}
        columns={budgetColumns(budget.currency)}
      />

      <div className="mt-10">
        <SectionTitle>Monthly Trend</SectionTitle>
        <CashFlowChart domainId={domainId} />
      </div>
    </>
  );
}

function CashFlowChart({ domainId }: { domainId: string }) {
  const state = useLedgerState();
  const data = monthlyCashFlow(state, domainId).slice(-6);
  return (
    <div className="border border-border rounded-lg bg-card p-4 h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--rule)" />
          <XAxis dataKey="month" fontSize={10} stroke="var(--muted-foreground)" />
          <YAxis
            fontSize={10}
            stroke="var(--muted-foreground)"
            tickFormatter={(v) => `$${Math.round(v / 1000)}k`}
          />
          <Tooltip
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              fontSize: 12,
            }}
          />
          <Bar dataKey="income" fill="var(--pos)" radius={[2, 2, 0, 0]} />
          <Bar dataKey="expense" fill="var(--neg)" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- Allocations ---------- */
function AllocationsTab({ domainId, basePath }: { domainId: string; basePath: string }) {
  const state = useLedgerState();
  const allocs = state.allocations.filter((a) => a.domainId === domainId);

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <p className="text-sm text-muted-foreground">Reserve money — without moving it.</p>
        <button
          type="button"
          onClick={() => openQuick("allocation", domainId)}
          className="text-sm border border-border rounded-md px-3 py-1.5 hover:bg-accent inline-flex items-center gap-1.5"
        >
          <Plus className="size-3.5" /> New Allocation
        </button>
      </div>
      <div className="space-y-3">
        {allocs.map((a) => {
          const total = allocationBalance(state, a.id);
          const byAcct = allocationByAccount(state, a.id);
          return (
            <Link
              key={a.id}
              to={`${basePath}/allocations/${a.id}`}
              className="block border border-border rounded-lg bg-card p-4 hover:border-foreground/20 transition-colors"
            >
              <div className="flex items-baseline justify-between mb-3">
                <div>
                  <div className="font-medium">{a.name}</div>
                  {a.target && (
                    <div className="text-xs text-muted-foreground">
                      Target {formatMoney(a.target, a.targetCurrency)}
                    </div>
                  )}
                </div>
                <div className="num text-lg font-medium">
                  {formatMoney(convert(state, total, "USD", a.targetCurrency), a.targetCurrency, {
                    compact: true,
                  })}
                </div>
              </div>
              <div className="flex flex-wrap gap-3 text-xs">
                {byAcct.map((b) => {
                  const obj = state.objects.find((o) => o.id === b.objectId);
                  if (!obj) return null;
                  return (
                    <div key={b.objectId} className="border border-border rounded-md px-2.5 py-1.5">
                      <span className="text-muted-foreground">{obj.name}</span>
                      <span className="ml-2 num">
                        {formatMoney(b.amount, obj.currency, { compact: true })}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}

/* ---------- Goals ---------- */
function GoalsTab({ domainId, basePath }: { domainId: string; basePath: string }) {
  const state = useLedgerState();
  const goals = state.goals.filter((g) => g.domainId === domainId);
  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <p className="text-sm text-muted-foreground">Track future objectives.</p>
        <button
          type="button"
          onClick={() => openQuick("goal", domainId)}
          className="text-sm border border-border rounded-md px-3 py-1.5 hover:bg-accent inline-flex items-center gap-1.5"
        >
          <Plus className="size-3.5" /> New Goal
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {goals.map((g) => {
          const { current, pct } = goalProgress(state, g.id);
          return (
            <Link
              key={g.id}
              to={`${basePath}/goals/${g.id}`}
              className="border border-border rounded-lg bg-card p-4 hover:border-foreground/20 transition-colors"
            >
              <div className="flex justify-between items-baseline mb-3">
                <div>
                  <div className="font-medium">{g.name}</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-widest mt-1">
                    Deadline ·{" "}
                    {new Date(g.deadline).toLocaleDateString("en-US", {
                      month: "short",
                      year: "numeric",
                    })}
                  </div>
                </div>
                <div className="num text-lg">{Math.round(pct * 100)}%</div>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-3">
                <div className="h-full bg-foreground" style={{ width: `${pct * 100}%` }} />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground num">
                <span>
                  {formatMoney(convert(state, current, "USD", g.currency), g.currency, {
                    compact: true,
                  })}
                </span>
                <span>{formatMoney(g.target, g.currency, { compact: true })}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}

/* ---------- Categories ---------- */
function AnalyticsTab({ domainId }: { domainId: string }) {
  const state = useLedgerState();
  const flow = monthlyCashFlow(state, domainId);
  // Running total of net cash flow (income minus spending) per month. It is
  // not net worth: it ignores balances that did not come from cash flow.
  const nw = flow.map((f, i) => ({
    month: f.month,
    value: flow.slice(0, i + 1).reduce((s, x) => s + x.net, 0),
  }));
  const totals = flow.reduce(
    (t, f) => ({ income: t.income + f.income, expense: t.expense + f.expense }),
    { income: 0, expense: 0 },
  );
  const usd = (n: number) => formatMoney(n, "USD", { compact: true });
  const ids = new Set(state.objects.filter((o) => o.domainId === domainId).map((o) => o.id));
  const byCategory = new Map<string, number>();
  for (const t of state.transactions) {
    if (t.status === "void" || NON_FLOW_KINDS.has(t.kind)) continue;
    for (const e of t.entries) {
      if (!e.categoryId || !ids.has(e.objectId)) continue;
      const obj = state.objects.find((o) => o.id === e.objectId)!;
      byCategory.set(
        e.categoryId,
        (byCategory.get(e.categoryId) ?? 0) - convert(state, e.amount, obj.currency, "USD"),
      );
    }
  }
  const topCategories = [...byCategory.entries()]
    .map(([id, v]) => ({
      name: state.categories.find((c) => c.id === id)?.name ?? "(deleted)",
      usd: v,
    }))
    .filter((c) => c.usd > 0)
    .sort((x, y) => y.usd - x.usd)
    .slice(0, 5);

  return (
    <div className="space-y-10">
      <div>
        <SectionTitle>Cash Flow</SectionTitle>
        <div className="border border-border rounded-lg bg-card p-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={flow}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--rule)" />
              <XAxis dataKey="month" fontSize={10} stroke="var(--muted-foreground)" />
              <YAxis
                fontSize={10}
                stroke="var(--muted-foreground)"
                tickFormatter={(v) => `$${Math.round(v / 1000)}k`}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  fontSize: 12,
                }}
              />
              <Bar dataKey="income" name="Income" fill="var(--pos)" radius={[2, 2, 0, 0]} />
              <Bar dataKey="expense" name="Expense" fill="var(--neg)" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <SectionTitle>Cumulative Net Cash Flow</SectionTitle>
        <div className="border border-border rounded-lg bg-card p-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={nw}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--rule)" />
              <XAxis dataKey="month" fontSize={10} stroke="var(--muted-foreground)" />
              <YAxis
                fontSize={10}
                stroke="var(--muted-foreground)"
                tickFormatter={(v) => `$${Math.round(v / 1000)}k`}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  fontSize: 12,
                }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--primary)"
                strokeWidth={2}
                dot={{ r: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ReadOnlyCard title="Income (all time)" value={usd(totals.income)} />
        <ReadOnlyCard title="Expenses (all time)" value={usd(totals.expense)} />
        <ReadOnlyCard
          title="Top spending categories"
          value={
            topCategories.length === 0 ? (
              "No categorised spending yet"
            ) : (
              <ul className="space-y-1">
                {topCategories.map((c) => (
                  <li key={c.name} className="flex justify-between">
                    <span>{c.name}</span>
                    <span className="num">{usd(c.usd)}</span>
                  </li>
                ))}
              </ul>
            )
          }
        />
        <ReadOnlyCard
          title="This month vs last month"
          value={
            flow.length < 2
              ? "Needs two months of activity"
              : `Spending ${usd(flow[flow.length - 1].expense)} vs ${usd(flow[flow.length - 2].expense)}`
          }
        />
      </div>
    </div>
  );
}

function ReadOnlyCard({ title, value }: { title: string; value: React.ReactNode }) {
  return (
    <div className="border border-border rounded-lg bg-card p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
        {title}
      </div>
      <div className="text-sm text-muted-foreground">{value}</div>
    </div>
  );
}

/* ---------- Quick-create ---------- */
// Tab buttons open the single QuickCreateDialog (mounted in AppLayout) through
// the UI store, scoped to the current domain.
const openQuick = (kind: QuickKind, domainId: string) => ui.openQuickCreate(kind, domainId);

/* ---------- Domain Settings ---------- */
function DomainSettingsTab({ domainId }: { domainId: string }) {
  const state = useLedgerState();
  const { updateDomain, deleteDomain } = useLedgerActions();
  const domain = state.domains.find((d) => d.id === domainId);
  const navigate = useNavigate();
  const workspaceCcy: CurrencyCode = state.settings?.defaultCurrency ?? "USD";

  // Keyed by domainId at the call site, so switching domains remounts with
  // that domain's values (the old useState seeds went stale across domains).
  const form = useAppForm({
    defaultValues: {
      name: domain?.name ?? "",
      description: domain?.description ?? "",
      displayCurrency: (domain?.displayCurrency ?? "inherit") as string,
    },
    validators: {
      onSubmit: ({ value }) =>
        value.name.trim() ? undefined : { fields: { name: "Domain name is required" } },
    },
    onSubmit: ({ value }) => {
      updateDomain(domainId, {
        name: value.name.trim(),
        description: value.description.trim() || undefined,
        displayCurrency:
          value.displayCurrency === "inherit" ? undefined : (value.displayCurrency as CurrencyCode),
      });
      toast.success("Domain settings saved");
    },
  });

  if (!domain) return <EmptyState title="Domain not found" />;

  const currencies: CurrencyCode[] = state.currencies?.length
    ? state.currencies
    : ["NGN", "USD", "GBP", "EUR"];
  const currencyOptions = [
    { value: "inherit", label: `Inherit workspace (${workspaceCcy})` },
    ...currencies.map((c) => ({ value: c, label: c })),
  ];

  const remove = () => {
    if (domainId === "personal") {
      toast.error("The Personal domain cannot be deleted.");
      return;
    }
    if (
      !confirm(
        `Delete "${domain.name}"? This removes its accounts, allocations, goals, budgets, and any transaction entries scoped to it. This cannot be undone.`,
      )
    )
      return;
    deleteDomain(domainId);
    toast.success("Domain deleted");
    void navigate({ to: "/businesses" });
  };

  return (
    <div className="max-w-2xl space-y-8">
      <p className="text-sm text-muted-foreground">
        Preferences that apply only inside this domain. Anything you leave blank inherits from your
        workspace defaults.
      </p>

      <form
        className="space-y-8"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <div className="space-y-4 border border-border rounded-lg bg-card p-5">
          <div className="font-medium">Identity</div>
          <form.AppField name="name">{(f) => <f.Text label="Name" />}</form.AppField>
          <form.AppField name="description">
            {(f) => <f.Text label="Description (optional)" placeholder="What this domain is for" />}
          </form.AppField>
          <div className="text-xs text-muted-foreground">
            Kind: <span className="capitalize">{domain.kind}</span>
          </div>
        </div>

        <div className="space-y-3 border border-border rounded-lg bg-card p-5">
          <div className="font-medium">Display currency</div>
          <p className="text-sm text-muted-foreground">
            Currency used for the domain's summary totals (net worth, cash, assets, liabilities).
            Individual account, budget, and goal amounts always show in their own native currency.
          </p>
          <div className="w-60">
            <form.AppField name="displayCurrency">
              {(f) => <f.Pick label="Currency" options={currencyOptions} />}
            </form.AppField>
          </div>
          <div className="text-xs text-muted-foreground">
            Advanced: keep a USD-denominated trading book beside NGN personal finances without
            touching the workspace-wide default.
          </div>
        </div>

        <form.AppForm>
          <form.SubmitButton>Save changes</form.SubmitButton>
        </form.AppForm>
      </form>

      <div className="border border-neg/30 rounded-lg bg-card p-5">
        <div className="font-medium text-neg">Danger zone</div>
        <p className="text-sm text-muted-foreground mt-1">
          Deleting a domain removes its accounts, allocations, goals, budgets, and scoped
          transaction entries. Workspace-level history is preserved.
        </p>
        <Button
          variant="ghost"
          className="mt-3 text-neg hover:text-neg"
          onClick={remove}
          disabled={domainId === "personal"}
        >
          <Trash2 className="size-4" /> Delete domain
        </Button>
      </div>
    </div>
  );
}
