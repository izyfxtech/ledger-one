import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import {
  useLedger,
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
  domainDisplayCurrency,
} from "@/lib/ledger";
import type { CurrencyCode } from "@/lib/ledger";
import { PageContainer, Stat, SectionTitle, EmptyState, Hero, HeroMeta } from "./page";
import { Plus, TrendingUp, TrendingDown, Trash2 } from "lucide-react";
import { QuickCreateDialog, type QuickKind } from "./quick-create";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
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

const TABS = [
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
export type DomainTab = (typeof TABS)[number];

export function DomainWorkspace({
  domainId,
  basePath,
  tab = "overview",
}: {
  domainId: string;
  basePath: string; // e.g. "/personal" or "/businesses/photography"
  tab?: DomainTab;
}) {
  const { state } = useLedger();
  const domain = state.domains.find((d) => d.id === domainId);
  if (!domain) return <PageContainer><EmptyState title="Domain not found" /></PageContainer>;

  const metrics = domainMetrics(state, domainId);

  const ddc = domainDisplayCurrency(state, domainId);
  const disp = (usd: number) => formatMoney(convert(state, usd, "USD", ddc), ddc, { compact: true });

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


      {tab === "overview" && <OverviewTab domainId={domainId} basePath={basePath} metrics={metrics} />}
      {tab === "accounts" && <AccountsTab domainId={domainId} basePath={basePath} />}
      {tab === "liabilities" && <LiabilitiesTab domainId={domainId} basePath={basePath} />}
      {tab === "transactions" && <TransactionsTab domainId={domainId} basePath={basePath} />}
      {tab === "budget" && <BudgetTab domainId={domainId} />}
      {tab === "allocations" && <AllocationsTab domainId={domainId} basePath={basePath} />}
      {tab === "goals" && <GoalsTab domainId={domainId} basePath={basePath} />}
      {tab === "categories" && <CategoriesTab />}
      {tab === "analytics" && <AnalyticsTab domainId={domainId} />}
      {tab === "settings" && <DomainSettingsTab domainId={domainId} />}
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
  const { state } = useLedger();
  const objs = state.objects.filter((o) => o.domainId === domainId);
  const accounts = objs.filter((o) => !isLiability(o));
  const liabs = objs.filter(isLiability);
  const txns = transactionsByDomain(state, domainId).slice(0, 10);
  const goals = state.goals.filter((g) => g.domainId === domainId);
  const allocs = state.allocations.filter((a) => a.domainId === domainId);
  const budget = state.budgets.find((b) => b.domainId === domainId);

  const ddc = domainDisplayCurrency(state, domainId);
  const disp = (usd: number) => formatMoney(convert(state, usd, "USD", ddc), ddc, { compact: true });

  return (
    <>


      <div className="grid grid-cols-12 gap-10">
        <div className="col-span-12 lg:col-span-7 space-y-10">
          <div>
            <SectionTitle action={<Link to={`${basePath}/accounts`} className="text-xs text-muted-foreground hover:text-foreground">View all →</Link>}>
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
                        <div className="text-xs text-muted-foreground truncate">{o.institution ?? o.kind}</div>
                      </div>
                      <div className="num text-sm font-medium tabular-nums whitespace-nowrap">
                        {formatMoney(balanceOf(state, o.id), o.currency, { compact: true })}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {liabs.length > 0 && (
            <div>
              <SectionTitle action={<Link to={`${basePath}/liabilities`} className="text-xs text-muted-foreground hover:text-foreground">View all →</Link>}>
                Liabilities
              </SectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {liabs.map((o) => (
                  <Link key={o.id} to={`${basePath}/liabilities/${o.id}`} className="border border-border rounded-lg bg-card p-3 border-l-2 border-l-neg hover:border-foreground/20 transition-colors">
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
            <SectionTitle action={<Link to={`${basePath}/transactions`} className="text-xs text-muted-foreground hover:text-foreground">View all →</Link>}>
              Recent Transactions
            </SectionTitle>
            <div className="border border-border rounded-lg bg-card divide-y divide-border">
              {txns.map((t) => {
                const first = t.entries[0];
                const obj = state.objects.find((o) => o.id === first.objectId);
                return (
                  <Link key={t.id} to={`/transactions/${t.id}`} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent/40">
                    <span className="num text-xs text-muted-foreground w-14">
                      {new Date(t.date).toLocaleDateString("en-US", { month: "short", day: "2-digit" })}
                    </span>
                    <span className="flex-1 truncate">{t.description}</span>
                    <span className={["num text-sm w-28 text-right", first.amount > 0 ? "text-pos" : first.amount < 0 ? "text-neg" : ""].join(" ")}>
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
              <SectionTitle action={<Link to={`${basePath}/budget`} className="text-xs text-muted-foreground hover:text-foreground">Open →</Link>}>
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
                          {formatMoney(spent, budget.currency, { compact: true })} / {formatMoney(line.amount, budget.currency, { compact: true })}
                        </span>
                      </div>
                      <div className="h-1 bg-muted rounded-full overflow-hidden">
                        <div className={["h-full", pct > 0.9 ? "bg-neg" : "bg-foreground"].join(" ")} style={{ width: `${pct * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {allocs.length > 0 && (
            <div>
              <SectionTitle action={<Link to={`${basePath}/allocations`} className="text-xs text-muted-foreground hover:text-foreground">Open →</Link>}>
                Allocations
              </SectionTitle>
              <div className="space-y-2.5">
                {allocs.map((a) => {
                  const bal = allocationBalance(state, a.id);
                  const targetUsd = a.target ? convert(state, a.target, a.targetCurrency, "USD") : 0;
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
              <SectionTitle action={<Link to={`${basePath}/goals`} className="text-xs text-muted-foreground hover:text-foreground">Open →</Link>}>
                Goals
              </SectionTitle>
              <div className="space-y-3">
                {goals.map((g) => {
                  const { pct } = goalProgress(state, g.id);
                  return (
                    <Link key={g.id} to={`${basePath}/goals/${g.id}`} className="block border border-border rounded-lg bg-card p-3 hover:border-foreground/20 transition-colors">
                      <div className="flex items-baseline justify-between mb-2">
                        <span className="text-sm font-medium">{g.name}</span>
                        <span className="num text-xs text-muted-foreground">{Math.round(pct * 100)}%</span>
                      </div>
                      <div className="h-1 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-foreground" style={{ width: `${pct * 100}%` }} />
                      </div>
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-2">
                        by {new Date(g.deadline).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
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

/* ---------- Accounts ---------- */
function AccountsTab({ domainId, basePath }: { domainId: string; basePath: string }) {
  const { state } = useLedger();
  const accounts = state.objects.filter((o) => o.domainId === domainId && !isLiability(o));
  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <p className="text-sm text-muted-foreground">Where money physically exists.</p>
        <button type="button" onClick={() => openQuick("account")} className="text-sm border border-border rounded-md px-3 py-1.5 hover:bg-accent inline-flex items-center gap-1.5">
          <Plus className="size-3.5" /> New Account
        </button>
      </div>
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <th className="text-left px-4 py-2 font-medium">Institution</th>
              <th className="text-left px-4 py-2 font-medium">Type</th>
              <th className="text-left px-4 py-2 font-medium">Currency</th>
              <th className="text-right px-4 py-2 font-medium">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {accounts.map((o) => (
              <tr key={o.id} className="hover:bg-accent/40 transition-colors">
                <td className="px-4 py-2.5">
                  <Link to={`${basePath}/accounts/${o.id}`} className="font-medium hover:underline">{o.name}</Link>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{o.institution ?? "—"}</td>
                <td className="px-4 py-2.5 text-muted-foreground capitalize">{o.kind}</td>
                <td className="px-4 py-2.5 num text-xs">{o.currency}</td>
                <td className="px-4 py-2.5 num text-right">{formatMoney(balanceOf(state, o.id), o.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ---------- Liabilities ---------- */
function LiabilitiesTab({ domainId, basePath }: { domainId: string; basePath: string }) {
  const { state } = useLedger();
  const liabs = state.objects.filter((o) => o.domainId === domainId && isLiability(o));
  if (liabs.length === 0) return <EmptyState title="No liabilities" description="Loans, credit cards, and mortgages will appear here." />;
  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <p className="text-sm text-muted-foreground">Manage obligations.</p>
        <button type="button" onClick={() => openQuick("liability")} className="text-sm border border-border rounded-md px-3 py-1.5 hover:bg-accent inline-flex items-center gap-1.5">
          <Plus className="size-3.5" /> New Liability
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {liabs.map((o) => {
          const bal = balanceOf(state, o.id);
          return (
            <Link key={o.id} to={`${basePath}/liabilities/${o.id}`} className="border border-border rounded-lg bg-card p-4 border-l-2 border-l-neg hover:border-foreground/20 transition-colors">
              <div className="flex justify-between items-baseline">
                <div>
                  <div className="font-medium">{o.name}</div>
                  <div className="text-xs text-muted-foreground">{o.institution}</div>
                </div>
                <div className="num text-lg text-neg">{formatMoney(bal, o.currency, { compact: true })}</div>
              </div>
              <div className="grid grid-cols-3 gap-3 mt-4 text-[11px]">
                <MiniLabel k="Interest" v={o.interestRate ? `${o.interestRate}%` : "—"} />
                <MiniLabel k="Min Payment" v={o.minPayment ? formatMoney(o.minPayment, o.currency, { compact: true }) : "—"} />
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
  const { state } = useLedger();
  const txns = transactionsByDomain(state, domainId);

  return (
    <>
      <p className="text-sm text-muted-foreground mb-4">The complete ledger — every event is derivable from these rows.</p>
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2 font-medium w-24">Date</th>
              <th className="text-left px-4 py-2 font-medium">Description</th>
              <th className="text-left px-4 py-2 font-medium">Account</th>
              <th className="text-left px-4 py-2 font-medium">Category</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="text-right px-4 py-2 font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {txns.map((t) => {
              const first = t.entries.find((e) => {
                const obj = state.objects.find((o) => o.id === e.objectId);
                return obj?.domainId === domainId;
              }) ?? t.entries[0];
              const obj = state.objects.find((o) => o.id === first.objectId);
              const cat = state.categories.find((c) => c.id === first.categoryId);
              const voided = t.status === "void";
              return (
                <tr key={t.id} className={["hover:bg-accent/30 transition-colors", voided ? "opacity-50" : ""].join(" ")}>
                  <td className="px-4 py-2 num text-xs text-muted-foreground">
                    {new Date(t.date).toLocaleDateString("en-US", { month: "short", day: "2-digit" })}
                  </td>
                  <td className="px-4 py-2">
                    <Link to={`/transactions/${t.id}`} className={["font-medium hover:underline", voided ? "line-through" : ""].join(" ")}>{t.description}</Link>
                    {t.entries.length > 1 && <span className="ml-2 text-[10px] text-muted-foreground">·{t.entries.length} entries</span>}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{obj?.name ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{cat?.name ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground text-xs capitalize">{t.status ?? "cleared"}</td>
                  <td className={["px-4 py-2 num text-right", voided ? "" : first.amount > 0 ? "text-pos" : first.amount < 0 ? "text-neg" : ""].join(" ")}>
                    {obj ? formatMoney(first.amount, obj.currency) : first.amount}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ---------- Budget ---------- */
function BudgetTab({ domainId }: { domainId: string }) {
  const { state } = useLedger();
  const budget = state.budgets.find((b) => b.domainId === domainId);
  if (!budget) return <EmptyState title="No budget for this domain" description="Plan spending for a month to see it here." action={<button type="button" onClick={() => openQuick("budget")} className="text-sm border border-border rounded-md px-3 py-1.5 hover:bg-accent">New Budget</button>} />;

  const lines = budget.lines.map((l) => {
    const cat = state.categories.find((c) => c.id === l.categoryId);
    const spent = budgetSpent(state, budget.id, l.categoryId);
    return { ...l, cat, spent, remaining: l.amount - spent, variance: spent - l.amount };
  });
  const totalBudget = budget.lines.reduce((s, l) => s + l.amount, 0);
  const totalSpent = lines.reduce((s, l) => s + l.spent, 0);

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <div className="flex gap-3 items-center">
          <span className="text-sm text-muted-foreground">Month</span>
          <span className="text-sm border border-border rounded-md px-3 py-1.5 num">{budget.month}</span>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled title="Coming soon" className="text-sm border border-border rounded-md px-3 py-1.5 opacity-50 cursor-not-allowed">Copy Previous Month</button>
          <button type="button" onClick={() => openQuick("budget")} className="text-sm border border-border rounded-md px-3 py-1.5 hover:bg-accent">New Budget</button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-8 pb-8 border-b border-border mb-8">
        <Stat label="Budget" value={formatMoney(totalBudget, budget.currency, { compact: true })} />
        <Stat label="Spent" value={formatMoney(totalSpent, budget.currency, { compact: true })} tone={totalSpent > totalBudget ? "neg" : "default"} />
        <Stat label="Remaining" value={formatMoney(Math.max(0, totalBudget - totalSpent), budget.currency, { compact: true })} />
      </div>

      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Category</th>
              <th className="text-right px-4 py-2 font-medium">Budget</th>
              <th className="text-right px-4 py-2 font-medium">Spent</th>
              <th className="text-right px-4 py-2 font-medium">Remaining</th>
              <th className="text-right px-4 py-2 font-medium">Variance</th>
              <th className="text-left px-4 py-2 font-medium w-40">Progress</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((l) => {
              const pct = Math.min(1, l.spent / l.amount);
              const over = l.spent > l.amount;
              return (
                <tr key={l.categoryId} className="hover:bg-accent/30">
                  <td className="px-4 py-2.5 font-medium">{l.cat?.name}</td>
                  <td className="px-4 py-2.5 num text-right">{formatMoney(l.amount, budget.currency, { compact: true })}</td>
                  <td className={["px-4 py-2.5 num text-right", over ? "text-neg" : ""].join(" ")}>{formatMoney(l.spent, budget.currency, { compact: true })}</td>
                  <td className="px-4 py-2.5 num text-right">{formatMoney(Math.max(0, l.remaining), budget.currency, { compact: true })}</td>
                  <td className={["px-4 py-2.5 num text-right", over ? "text-neg" : "text-muted-foreground"].join(" ")}>{formatMoney(l.variance, budget.currency, { signed: true, compact: true })}</td>
                  <td className="px-4 py-2.5">
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className={["h-full", over ? "bg-neg" : pct > 0.9 ? "bg-neg" : "bg-foreground"].join(" ")} style={{ width: `${pct * 100}%` }} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-10">
        <SectionTitle>Monthly Trend</SectionTitle>
        <CashFlowChart domainId={domainId} />
      </div>
    </>
  );
}

function CashFlowChart({ domainId }: { domainId: string }) {
  const { state } = useLedger();
  const data = monthlyCashFlow(state, domainId).slice(-6);
  return (
    <div className="border border-border rounded-lg bg-card p-4 h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--rule)" />
          <XAxis dataKey="month" fontSize={10} stroke="var(--muted-foreground)" />
          <YAxis fontSize={10} stroke="var(--muted-foreground)" tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
          <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12 }} />
          <Bar dataKey="income" fill="var(--pos)" radius={[2, 2, 0, 0]} />
          <Bar dataKey="expense" fill="var(--neg)" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- Allocations ---------- */
function AllocationsTab({ domainId, basePath }: { domainId: string; basePath: string }) {
  const { state } = useLedger();
  const allocs = state.allocations.filter((a) => a.domainId === domainId);

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <p className="text-sm text-muted-foreground">Reserve money — without moving it.</p>
        <button type="button" onClick={() => openQuick("allocation")} className="text-sm border border-border rounded-md px-3 py-1.5 hover:bg-accent inline-flex items-center gap-1.5">
          <Plus className="size-3.5" /> New Allocation
        </button>
      </div>
      <div className="space-y-3">
        {allocs.map((a) => {
          const total = allocationBalance(state, a.id);
          const byAcct = allocationByAccount(state, a.id);
          return (
            <Link key={a.id} to={`${basePath}/allocations/${a.id}`} className="block border border-border rounded-lg bg-card p-4 hover:border-foreground/20 transition-colors">
              <div className="flex items-baseline justify-between mb-3">
                <div>
                  <div className="font-medium">{a.name}</div>
                  {a.target && (
                    <div className="text-xs text-muted-foreground">Target {formatMoney(a.target, a.targetCurrency)}</div>
                  )}
                </div>
                <div className="num text-lg font-medium">{formatMoney(Math.abs(total), "USD", { compact: true })}</div>
              </div>
              <div className="flex flex-wrap gap-3 text-xs">
                {byAcct.map((b) => {
                  const obj = state.objects.find((o) => o.id === b.objectId);
                  if (!obj) return null;
                  return (
                    <div key={b.objectId} className="border border-border rounded-md px-2.5 py-1.5">
                      <span className="text-muted-foreground">{obj.name}</span>
                      <span className="ml-2 num">{formatMoney(b.amount, obj.currency, { compact: true })}</span>
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
  const { state } = useLedger();
  const goals = state.goals.filter((g) => g.domainId === domainId);
  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <p className="text-sm text-muted-foreground">Track future objectives.</p>
        <button type="button" onClick={() => openQuick("goal")} className="text-sm border border-border rounded-md px-3 py-1.5 hover:bg-accent inline-flex items-center gap-1.5">
          <Plus className="size-3.5" /> New Goal
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {goals.map((g) => {
          const { current, pct } = goalProgress(state, g.id);
          return (
            <Link key={g.id} to={`${basePath}/goals/${g.id}`} className="border border-border rounded-lg bg-card p-4 hover:border-foreground/20 transition-colors">
              <div className="flex justify-between items-baseline mb-3">
                <div>
                  <div className="font-medium">{g.name}</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-widest mt-1">
                    Deadline · {new Date(g.deadline).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                  </div>
                </div>
                <div className="num text-lg">{Math.round(pct * 100)}%</div>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-3">
                <div className="h-full bg-foreground" style={{ width: `${pct * 100}%` }} />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground num">
                <span>{formatMoney(current, "USD", { compact: true })}</span>
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
function CategoriesTab() {
  const { state } = useLedger();
  const income = state.categories.filter((c) => c.type === "income");
  const expense = state.categories.filter((c) => c.type === "expense");

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      <CategoryTree title="Income" cats={income} />
      <CategoryTree title="Expense" cats={expense} />
    </div>
  );
}

function CategoryTree({ title, cats }: { title: string; cats: { id: string; name: string; parentId?: string }[] }) {
  const roots = cats.filter((c) => !c.parentId);
  return (
    <div>
      <SectionTitle
        action={
          <div className="flex gap-2 text-xs">
            <button type="button" disabled title="Coming soon" className="text-muted-foreground opacity-50 cursor-not-allowed">New</button>
            <button type="button" disabled title="Coming soon" className="text-muted-foreground opacity-50 cursor-not-allowed">Merge</button>
            <button type="button" disabled title="Coming soon" className="text-muted-foreground opacity-50 cursor-not-allowed">Archive</button>
          </div>
        }
      >
        {title}
      </SectionTitle>
      <div className="border border-border rounded-lg bg-card">
        {roots.map((r) => {
          const kids = cats.filter((c) => c.parentId === r.id);
          return (
            <div key={r.id} className="border-b border-border last:border-b-0">
              <div className="px-4 py-2 font-medium text-sm">{r.name}</div>
              {kids.length > 0 && (
                <ul className="pl-8 pb-2">
                  {kids.map((k) => (
                    <li key={k.id} className="text-sm py-1 text-muted-foreground">
                      {k.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Analytics ---------- */
function AnalyticsTab({ domainId }: { domainId: string }) {
  const { state } = useLedger();
  const flow = monthlyCashFlow(state, domainId);
  const nw = useMemo(() => {
    // rough running net worth per month
    const items = flow.map((f, i) => ({ month: f.month, value: flow.slice(0, i + 1).reduce((s, x) => s + x.net, 0) }));
    return items;
  }, [flow]);

  return (
    <div className="space-y-10">
      <div>
        <SectionTitle>Cash Flow</SectionTitle>
        <div className="border border-border rounded-lg bg-card p-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={flow}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--rule)" />
              <XAxis dataKey="month" fontSize={10} stroke="var(--muted-foreground)" />
              <YAxis fontSize={10} stroke="var(--muted-foreground)" tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
              <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12 }} />
              <Bar dataKey="income" name="Income" fill="var(--pos)" radius={[2, 2, 0, 0]} />
              <Bar dataKey="expense" name="Expense" fill="var(--neg)" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <SectionTitle>Net Worth Trend</SectionTitle>
        <div className="border border-border rounded-lg bg-card p-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={nw}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--rule)" />
              <XAxis dataKey="month" fontSize={10} stroke="var(--muted-foreground)" />
              <YAxis fontSize={10} stroke="var(--muted-foreground)" tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
              <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12 }} />
              <Line type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ReadOnlyCard title="Income" value={<TrendingUp className="size-5 text-pos" />} />
        <ReadOnlyCard title="Expenses" value={<TrendingDown className="size-5 text-neg" />} />
        <ReadOnlyCard title="Category Breakdown" value="—" />
        <ReadOnlyCard title="Monthly Comparison" value="—" />
      </div>
    </div>
  );
}

function ReadOnlyCard({ title, value }: { title: string; value: React.ReactNode }) {
  return (
    <div className="border border-border rounded-lg bg-card p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">{title}</div>
      <div className="text-sm text-muted-foreground">{value}</div>
    </div>
  );
}

/* ---------- Quick-create bridge ---------- */
// Any tab button can request the topbar's QuickCreateDialog by dispatching
// this event; AppTopbar listens and opens the correct dialog.
function openQuick(kind: QuickKind) {
  window.dispatchEvent(new CustomEvent("ledgerone:quick-create", { detail: kind }));
}

/* ---------- Domain Settings ---------- */
function DomainSettingsTab({ domainId }: { domainId: string }) {
  const { state, updateDomain, deleteDomain } = useLedger();
  const domain = state.domains.find((d) => d.id === domainId);
  const navigate = useNavigate();
  const [name, setName] = useState(domain?.name ?? "");
  const [description, setDescription] = useState(domain?.description ?? "");
  const workspaceCcy: CurrencyCode = state.settings?.defaultCurrency ?? "USD";
  const [displayCurrency, setDisplayCurrency] = useState<CurrencyCode | "inherit">(
    domain?.displayCurrency ?? "inherit",
  );

  if (!domain) return <EmptyState title="Domain not found" />;

  const currencies: CurrencyCode[] = state.currencies?.length
    ? state.currencies
    : ["NGN", "USD", "GBP", "EUR"];

  const save = () => {
    if (!name.trim()) {
      toast.error("Domain name is required");
      return;
    }
    updateDomain(domainId, {
      name: name.trim(),
      description: description.trim() || undefined,
      displayCurrency: displayCurrency === "inherit" ? undefined : displayCurrency,
    });
    toast.success("Domain settings saved");
  };

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
    navigate(domain.kind === "personal" ? "/" : "/businesses");
  };

  return (
    <div className="max-w-2xl space-y-8">
      <p className="text-sm text-muted-foreground">
        Preferences that apply only inside this domain. Anything you leave blank
        inherits from your workspace defaults.
      </p>

      <div className="space-y-4 border border-border rounded-lg bg-card p-5">
        <div className="font-medium">Identity</div>
        <label className="block">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Name</div>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
            Description <span className="text-muted-foreground/60">(optional)</span>
          </div>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Freelance photography — invoices, gear, taxes."
          />
        </label>
        <div className="text-xs text-muted-foreground">
          Kind: <span className="capitalize">{domain.kind}</span>
        </div>
      </div>

      <div className="space-y-3 border border-border rounded-lg bg-card p-5">
        <div className="font-medium">Display currency</div>
        <p className="text-sm text-muted-foreground">
          Currency used for the domain's summary totals (net worth, cash, assets,
          liabilities). Individual account, budget, and goal amounts always show in
          their own native currency.
        </p>
        <Select
          value={displayCurrency}
          onValueChange={(v) => setDisplayCurrency(v as CurrencyCode | "inherit")}
        >
          <SelectTrigger className="w-60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit">Inherit workspace ({workspaceCcy})</SelectItem>
            {currencies.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="text-xs text-muted-foreground">
          Advanced: keep a USD-denominated trading book beside NGN personal finances
          without touching the workspace-wide default.
        </div>
      </div>

      <div className="flex gap-2">
        <Button onClick={save}>Save changes</Button>
      </div>

      <div className="border border-neg/30 rounded-lg bg-card p-5">
        <div className="font-medium text-neg">Danger zone</div>
        <p className="text-sm text-muted-foreground mt-1">
          Deleting a domain removes its accounts, allocations, goals, budgets, and
          scoped transaction entries. Workspace-level history is preserved.
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
