// no router import needed
import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState, PageContainer, PageHeader, SectionTitle, Stat } from "@/components/page";
import { useLedger } from "@/lib/ledger";
import { accountsToCsv, transactionsToCsv } from "@/lib/ledger/csv";
import {
  balanceOf,
  budgetSpent,
  convert,
  domainMetrics,
  formatMoney,
  isAsset,
  isLiability,
  monthlyCashFlow,
  workspaceDisplayCurrency,
  workspaceMetrics,
} from "@/lib/ledger/selectors";
import type { Budget, LedgerState } from "@/lib/ledger/types";

const TABS = [
  "Overview",
  "Net Worth",
  "Cash Flow",
  "Balance Sheet",
  "Income Statement",
  "Budget",
  "Allocation",
  "Goal",
  "Business Comparison",
  "Currency Exposure",
  "Exports",
] as const;
type Tab = (typeof TABS)[number];

/**
 * Build a display helper bound to the workspace's chosen reporting
 * currency. All aggregate selectors return USD-normalised numbers, so we
 * convert once at the presentation layer and format in the user's
 * currency.
 */
function useDisplay(state: LedgerState) {
  const wdc = workspaceDisplayCurrency(state);
  const disp = (usd: number) =>
    formatMoney(convert(state, usd, "USD", wdc), wdc, { compact: true });
  return { wdc, disp };
}

export default function ReportsPage() {

  const [tab, setTab] = useState<Tab>("Overview");
  const { state } = useLedger();
  const ws = useMemo(() => workspaceMetrics(state), [state]);
  const { disp } = useDisplay(state);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Reports"
        title="Workspace reports"
        description="Read-only views across every domain. Filter by date, domain, currency, category, or account."
      />

      <div className="flex flex-wrap gap-1 border-b border-border mb-8">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              "px-3 py-2 text-sm border-b-2 -mb-px transition-colors",
              tab === t
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 border-b border-border pb-8 mb-8">
          <Stat
            label="Net worth"
            value={disp(ws.netWorth)}
            tone={ws.netWorth >= 0 ? "pos" : "neg"}
          />
          <Stat label="Total assets" value={disp(ws.assets)} />
          <Stat
            label="Total liabilities"
            value={disp(ws.liabilities)}
            tone="neg"
          />
          <Stat
            label="Cash available"
            value={disp(ws.cashAvailable)}
          />
        </div>
      )}

      {tab === "Overview" && <NetWorthByDomain />}
      {tab === "Net Worth" && <NetWorthByDomain />}
      {tab === "Cash Flow" && <CashFlowReport />}
      {tab === "Balance Sheet" && <BalanceSheet />}
      {tab === "Income Statement" && <IncomeStatement />}
      {tab === "Budget" && <BudgetReport />}
      {tab === "Allocation" && <AllocationReport />}
      {tab === "Goal" && <GoalReport />}
      {tab === "Business Comparison" && <BusinessComparison />}
      {tab === "Currency Exposure" && <CurrencyExposure />}
      {tab === "Exports" && <ExportsPanel />}
    </PageContainer>
  );
}

function NetWorthByDomain() {
  const { state } = useLedger();
  const { wdc, disp } = useDisplay(state);
  const rows = state.domains.map((d) => {
    const m = domainMetrics(state, d.id);
    return {
      name: d.name,
      netWorth: convert(state, m.netWorth, "USD", wdc),
    };
  });
  return (
    <section className="mb-10">
      <SectionTitle>Net worth by domain</SectionTitle>
      <div className="border border-border rounded-lg p-4">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" />
            <YAxis tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" />
            <Tooltip
              contentStyle={{
                background: "var(--color-background)",
                border: "1px solid var(--color-border)",
                fontSize: 12,
              }}
              formatter={((v: number) => formatMoney(v, wdc, { compact: true })) as any}
            />
            <Bar dataKey="netWorth" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function CashFlowReport() {
  const { state } = useLedger();
  const { wdc } = useDisplay(state);
  const monthly = new Map<string, { income: number; expense: number }>();
  for (const d of state.domains) {
    for (const row of monthlyCashFlow(state, d.id)) {
      const cur = monthly.get(row.month) ?? { income: 0, expense: 0 };
      cur.income += row.income;
      cur.expense += row.expense;
      monthly.set(row.month, cur);
    }
  }
  const data = Array.from(monthly.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month,
      income: convert(state, v.income, "USD", wdc),
      expense: convert(state, v.expense, "USD", wdc),
      net: convert(state, v.income - v.expense, "USD", wdc),
    }));
  return (
    <section className="mb-10">
      <SectionTitle>Cash flow · workspace</SectionTitle>
      <div className="border border-border rounded-lg p-4">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" />
            <YAxis tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" />
            <Tooltip
              contentStyle={{
                background: "var(--color-background)",
                border: "1px solid var(--color-border)",
                fontSize: 12,
              }}
              formatter={((v: number) => formatMoney(v, wdc, { compact: true })) as any}
            />
            <Line type="monotone" dataKey="income" stroke="var(--color-pos)" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="expense" stroke="var(--color-neg)" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="net" stroke="var(--color-primary)" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function BalanceSheet() {
  const { state } = useLedger();
  const { disp } = useDisplay(state);
  const rows = state.domains.map((d) => {
    const m = domainMetrics(state, d.id);
    return { name: d.name, ...m };
  });
  return (
    <section className="mb-10">
      <SectionTitle>Balance sheet · workspace</SectionTitle>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Domain</th>
              <th className="text-right px-4 py-2 font-medium">Assets</th>
              <th className="text-right px-4 py-2 font-medium">Liabilities</th>
              <th className="text-right px-4 py-2 font-medium">Liquid</th>
              <th className="text-right px-4 py-2 font-medium">Net worth</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-t border-border">
                <td className="px-4 py-2.5">{r.name}</td>
                <td className="px-4 py-2.5 text-right num">{disp(r.assets)}</td>
                <td className="px-4 py-2.5 text-right num text-neg">
                  {disp(r.liabilities)}
                </td>
                <td className="px-4 py-2.5 text-right num">{disp(r.liquid)}</td>
                <td
                  className={[
                    "px-4 py-2.5 text-right num font-medium",
                    r.netWorth >= 0 ? "text-pos" : "text-neg",
                  ].join(" ")}
                >
                  {disp(r.netWorth)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function IncomeStatement() {
  const { state } = useLedger();
  const { disp } = useDisplay(state);
  const rows = state.domains.map((d) => {
    let income = 0, expense = 0;
    for (const row of monthlyCashFlow(state, d.id)) {
      income += row.income;
      expense += row.expense;
    }
    return { name: d.name, income, expense, net: income - expense };
  });
  return (
    <section className="mb-10">
      <SectionTitle>Income statement · lifetime</SectionTitle>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Domain</th>
              <th className="text-right px-4 py-2 font-medium">Income</th>
              <th className="text-right px-4 py-2 font-medium">Expense</th>
              <th className="text-right px-4 py-2 font-medium">Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-t border-border">
                <td className="px-4 py-2.5">{r.name}</td>
                <td className="px-4 py-2.5 text-right num text-pos">+{disp(r.income)}</td>
                <td className="px-4 py-2.5 text-right num text-neg">−{disp(r.expense)}</td>
                <td className={["px-4 py-2.5 text-right num font-medium", r.net >= 0 ? "text-pos" : "text-neg"].join(" ")}>
                  {disp(r.net)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BudgetReport() {
  const { state } = useLedger();
  const budgets = [...state.budgets].sort((a, b) => b.month.localeCompare(a.month));

  return (
    <section className="mb-10">
      <SectionTitle>Budget performance</SectionTitle>
      {budgets.length === 0 ? (
        <EmptyState
          title="No budgets yet"
          description="Set up a monthly budget for a domain to see planned-vs-actual spending here."
        />
      ) : (
        <div className="space-y-6">
          {budgets.map((b) => (
            <BudgetCard key={b.id} budget={b} />
          ))}
        </div>
      )}
    </section>
  );
}

function BudgetCard({ budget }: { budget: Budget }) {
  const { state } = useLedger();
  const domain = state.domains.find((d) => d.id === budget.domainId);
  const rows = budget.lines.map((line) => {
    const category = state.categories.find((c) => c.id === line.categoryId);
    const spent = budgetSpent(state, budget.id, line.categoryId);
    const remaining = line.amount - spent;
    const pct = line.amount > 0 ? Math.round((spent / line.amount) * 100) : spent > 0 ? 100 : 0;
    return {
      key: line.categoryId,
      name: category?.name ?? "Uncategorized",
      planned: line.amount,
      spent,
      remaining,
      pct,
      over: spent > line.amount,
    };
  });
  const totalPlanned = rows.reduce((acc, r) => acc + r.planned, 0);
  const totalSpent = rows.reduce((acc, r) => acc + r.spent, 0);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-muted/40 border-b border-border">
        <div>
          <div className="font-medium">{domain?.name ?? "Unknown domain"}</div>
          <div className="text-xs text-muted-foreground">{budget.month}</div>
        </div>
        <div className="text-right">
          <div className={["num text-sm font-medium", totalSpent > totalPlanned ? "text-neg" : ""].join(" ")}>
            {formatMoney(totalSpent, budget.currency, { compact: true })}
            {" / "}
            {formatMoney(totalPlanned, budget.currency, { compact: true })}
          </div>
          <div className="text-xs text-muted-foreground">spent of planned</div>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-sm text-muted-foreground">No category lines on this budget.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Category</th>
              <th className="text-right px-4 py-2 font-medium">Planned</th>
              <th className="text-right px-4 py-2 font-medium">Spent</th>
              <th className="text-right px-4 py-2 font-medium">Remaining</th>
              <th className="text-left px-4 py-2 font-medium w-32">Progress</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-border">
                <td className="px-4 py-2.5">{r.name}</td>
                <td className="px-4 py-2.5 text-right num">
                  {formatMoney(r.planned, budget.currency, { compact: true })}
                </td>
                <td className={["px-4 py-2.5 text-right num", r.over ? "text-neg" : ""].join(" ")}>
                  {formatMoney(r.spent, budget.currency, { compact: true })}
                </td>
                <td className={["px-4 py-2.5 text-right num", r.remaining < 0 ? "text-neg" : "text-pos"].join(" ")}>
                  {formatMoney(r.remaining, budget.currency, { compact: true, signed: true })}
                </td>
                <td className="px-4 py-2.5">
                  <div className="h-1.5 w-full max-w-28 rounded-full bg-muted overflow-hidden">
                    <div
                      className={["h-full rounded-full", r.over ? "bg-neg" : "bg-primary"].join(" ")}
                      style={{ width: `${Math.min(100, Math.max(0, r.pct))}%` }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function AllocationReport() {
  const { state } = useLedger();
  const { wdc } = useDisplay(state);
  const rows = state.allocations.map((a) => {
    let usd = 0;
    for (const t of state.transactions)
      for (const e of t.entries)
        if (e.allocationId === a.id) {
          const obj = state.objects.find((o) => o.id === e.objectId);
          if (obj) usd += convert(state, e.amount, obj.currency, "USD");
        }
    return { name: a.name, amount: Math.max(0, convert(state, usd, "USD", wdc)) };
  });
  return (
    <section className="mb-10">
      <SectionTitle>Allocations · workspace</SectionTitle>
      <div className="border border-border rounded-lg p-4">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={rows} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" width={140} />
            <Tooltip
              contentStyle={{
                background: "var(--color-background)",
                border: "1px solid var(--color-border)",
                fontSize: 12,
              }}
              formatter={((v: number) => formatMoney(v, wdc, { compact: true })) as any}
            />
            <Bar dataKey="amount" fill="var(--color-primary)" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function GoalReport() {
  const { state } = useLedger();
  return (
    <section className="mb-10">
      <SectionTitle>Goal progress</SectionTitle>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {state.goals.map((g) => {
          return (
            <div key={g.id} className="border border-border rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="font-medium">{g.name}</div>
                <div className="text-xs text-muted-foreground">by {g.deadline ?? "—"}</div>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                target {formatMoney(g.target, g.currency, { compact: true })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function BusinessComparison() {
  const { state } = useLedger();
  const { wdc } = useDisplay(state);
  const businesses = state.domains.filter((d) => d.kind !== "personal");
  const rows = businesses.map((d) => {
    const m = domainMetrics(state, d.id);
    return {
      name: d.name,
      assets: convert(state, m.assets, "USD", wdc),
      liabilities: convert(state, m.liabilities, "USD", wdc),
    };
  });
  return (
    <section className="mb-10">
      <SectionTitle>Business comparison</SectionTitle>
      <div className="border border-border rounded-lg p-4">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" />
            <YAxis tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" />
            <Tooltip
              contentStyle={{
                background: "var(--color-background)",
                border: "1px solid var(--color-border)",
                fontSize: 12,
              }}
              formatter={((v: number) => formatMoney(v, wdc, { compact: true })) as any}
            />
            <Bar dataKey="assets" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="liabilities" fill="var(--color-neg)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function CurrencyExposure() {
  const { state } = useLedger();
  const { wdc } = useDisplay(state);
  const byCcy = new Map<string, number>();
  for (const o of state.objects) {
    const b = balanceOf(state, o.id);
    if (isLiability(o)) continue;
    if (!isAsset(o)) continue;
    const inWdc = convert(state, b, o.currency, wdc);
    byCcy.set(o.currency, (byCcy.get(o.currency) ?? 0) + inWdc);
  }
  const data = Array.from(byCcy.entries()).map(([name, value]) => ({ name, value: Math.max(0, value) }));
  const colors = ["var(--color-primary)", "var(--color-pos)", "var(--color-neg)", "var(--color-muted-foreground)"];
  return (
    <section className="mb-10">
      <SectionTitle>Currency exposure (assets)</SectionTitle>
      <div className="border border-border rounded-lg p-4">
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={60} outerRadius={110} paddingAngle={2}>
              {data.map((_, i) => (
                <Cell key={i} fill={colors[i % colors.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "var(--color-background)",
                border: "1px solid var(--color-border)",
                fontSize: 12,
              }}
              formatter={((v: number, n: string) => [formatMoney(v, wdc, { compact: true }), n]) as any}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function ExportsPanel() {
  const { state } = useLedger();
  const [busy, setBusy] = useState<string | null>(null);

  const saveCsv = async (label: string, filename: string, content: string) => {
    setBusy(label);
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: filename,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!path) return; // cancelled
      await invoke("write_export_file", { path, content });
      toast.success(`${label} saved`);
    } catch (err) {
      console.error(`[export] ${label} failed:`, err);
      toast.error(`Couldn't save ${label}`);
    } finally {
      setBusy(null);
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const csvExports = [
    {
      label: "CSV — Transactions",
      hint: "Every entry, one row each, with domain/account/category.",
      onClick: () => saveCsv("Transactions", `ledgerone-transactions-${today}.csv`, transactionsToCsv(state)),
    },
    {
      label: "CSV — Accounts",
      hint: "Every account with its current balance.",
      onClick: () => saveCsv("Accounts", `ledgerone-accounts-${today}.csv`, accountsToCsv(state)),
    },
  ];
  const comingSoon = ["PDF — Balance Sheet", "PDF — Income Statement"];

  return (
    <section className="mb-10 grid gap-3 md:grid-cols-2">
      {csvExports.map((x) => (
        <div key={x.label} className="border border-border rounded-lg p-5 flex items-center justify-between">
          <div>
            <div className="font-medium">{x.label}</div>
            <div className="text-xs text-muted-foreground mt-1">{x.hint}</div>
          </div>
          <button
            type="button"
            onClick={x.onClick}
            disabled={busy !== null}
            className="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-accent disabled:opacity-50 disabled:pointer-events-none"
          >
            {busy === x.label.replace("CSV — ", "") ? "Saving…" : "Save…"}
          </button>
        </div>
      ))}
      {comingSoon.map((x) => (
        <div key={x} className="border border-border rounded-lg p-5 flex items-center justify-between opacity-60">
          <div>
            <div className="font-medium">{x}</div>
            <div className="text-xs text-muted-foreground mt-1">Not built yet.</div>
          </div>
          <button
            type="button"
            disabled
            title="Coming soon"
            className="text-sm px-3 py-1.5 rounded-md border border-border cursor-not-allowed"
          >
            Coming soon
          </button>
        </div>
      ))}
    </section>
  );
}

