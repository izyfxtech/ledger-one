import { Link } from "react-router-dom";
import {
  useLedger,
  formatMoney,
  balanceOf,
  transactionsForObject,
  allocationBalance,
  allocationByAccount,
  goalProgress,
  convert,
  isLiability,
} from "@/lib/ledger";
import type { CurrencyCode, Transaction, TransactionStatus } from "@/lib/ledger";
import { canPerform } from "@/lib/local-store";
import { PageContainer, SectionTitle, Stat, EmptyState, Hero, HeroMeta } from "./page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { ArrowLeft, ExternalLink } from "lucide-react";

const STATUS_OPTIONS: { value: TransactionStatus; label: string; hint: string }[] = [
  { value: "pending", label: "Pending", hint: "Not yet settled" },
  { value: "cleared", label: "Cleared", hint: "Settled — counts toward every balance" },
  { value: "reconciled", label: "Reconciled", hint: "Cleared and matched against a statement" },
  { value: "void", label: "Void", hint: "Kept on record, excluded from every balance" },
];

function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
    >
      <ArrowLeft className="size-3.5" />
      {label}
    </Link>
  );
}

function TxnRow({ t, highlightObjectId }: { t: Transaction; highlightObjectId?: string }) {
  const { state } = useLedger();
  const entry =
    (highlightObjectId && t.entries.find((e) => e.objectId === highlightObjectId)) || t.entries[0];
  const obj = state.objects.find((o) => o.id === entry.objectId);
  const voided = t.status === "void";
  return (
    <Link
      to={`/transactions/${t.id}`}
      className={[
        "flex items-center gap-4 px-4 py-2.5 text-sm hover:bg-accent/50 transition-colors",
        voided ? "opacity-50" : "",
      ].join(" ")}
    >

      <span className="num text-xs text-muted-foreground w-14">
        {new Date(t.date).toLocaleDateString("en-US", { month: "short", day: "2-digit" })}
      </span>
      <span className={["flex-1 truncate", voided ? "line-through" : ""].join(" ")}>{t.description}</span>
      {voided && (
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground border border-border rounded-md px-1.5 py-0.5">
          Void
        </span>
      )}
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground w-24 truncate">
        {t.kind.replace("_", " ")}
      </span>
      <span
        className={[
          "num text-sm w-32 text-right",
          voided ? "" : entry.amount > 0 ? "text-pos" : entry.amount < 0 ? "text-neg" : "",
        ].join(" ")}
      >
        {obj ? formatMoney(entry.amount, obj.currency, { signed: true }) : entry.amount}
      </span>
    </Link>
  );
}

export function AccountDetail({ objectId, basePath }: { objectId: string; basePath: string }) {
  const { state } = useLedger();
  const obj = state.objects.find((o) => o.id === objectId);
  if (!obj) {
    return (
      <PageContainer>
        <BackLink to={basePath + "/accounts"} label="Back to accounts" />
        <EmptyState title="Account not found" description="This financial object doesn't exist in the workspace." />
      </PageContainer>
    );
  }
  const bal = balanceOf(state, obj.id);
  const usd = convert(state, bal, obj.currency, "USD");
  const txns = transactionsForObject(state, obj.id);
  const liability = isLiability(obj);
  const backLabel =
    liability ? "Back to liabilities" : "Back to accounts";
  const backTo = liability ? basePath + "/liabilities" : basePath + "/accounts";

  return (
    <PageContainer>
      <BackLink to={backTo} label={backLabel} />
      <Hero
        eyebrow={obj.institution ?? obj.kind.replace("_", " ")}
        title={obj.name}
        value={formatMoney(bal, obj.currency, { compact: true })}
        valueTone={liability ? "neg" : bal < 0 ? "neg" : "default"}
        valueHint={
          liability
            ? `Balance owed · derived from ${txns.length} ${txns.length === 1 ? "entry" : "entries"}`
            : `Balance · derived from ${txns.length} ${txns.length === 1 ? "entry" : "entries"}`
        }
        meta={
          <>
            {obj.currency !== "USD" && (
              <HeroMeta label="≈ USD" value={formatMoney(usd, "USD", { compact: true })} />
            )}
            <HeroMeta label="Currency" value={obj.currency} />
            {obj.creditLimit != null && (
              <HeroMeta
                label="Utilization"
                value={`${Math.round((Math.max(0, bal) / obj.creditLimit) * 100)}%`}
              />
            )}
            {obj.interestRate != null && <HeroMeta label="Interest" value={`${obj.interestRate}%`} />}
            {obj.minPayment != null && (
              <HeroMeta label="Min payment" value={formatMoney(obj.minPayment, obj.currency, { compact: true })} />
            )}
            {obj.dueDay != null && <HeroMeta label="Due day" value={`Day ${obj.dueDay}`} />}
          </>
        }
      />


      <SectionTitle>Ledger history</SectionTitle>
      {txns.length === 0 ? (
        <EmptyState title="No transactions" description="This account has no ledger entries yet." />
      ) : (
        <div className="border border-border rounded-lg bg-card divide-y divide-border overflow-hidden">
          {txns.map((t) => (
            <TxnRow key={t.id} t={t} highlightObjectId={obj.id} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}

export function AllocationDetail({ allocationId, basePath }: { allocationId: string; basePath: string }) {
  const { state } = useLedger();
  const a = state.allocations.find((x) => x.id === allocationId);
  if (!a) {
    return (
      <PageContainer>
        <BackLink to={basePath + "/allocations"} label="Back to allocations" />
        <EmptyState title="Allocation not found" />
      </PageContainer>
    );
  }
  const balUsd = allocationBalance(state, a.id);
  const targetUsd = a.target != null ? convert(state, a.target, a.targetCurrency, "USD") : null;
  const pct = targetUsd && targetUsd > 0 ? Math.min(1, balUsd / targetUsd) : null;
  const byAccount = allocationByAccount(state, a.id);
  const relatedTxns = state.transactions.filter((t) =>
    t.entries.some((e) => e.allocationId === a.id),
  );

  return (
    <PageContainer>
      <BackLink to={basePath + "/allocations"} label="Back to allocations" />
      <Hero
        eyebrow="Allocation"
        title={a.name}
        value={formatMoney(convert(state, balUsd, "USD", a.targetCurrency), a.targetCurrency, { compact: true })}
        valueHint={
          pct != null
            ? `${Math.round(pct * 100)}% of ${formatMoney(a.target!, a.targetCurrency, { compact: true })} target`
            : "Mentally reserved — money stays in its account"
        }
        meta={
          <>
            {a.target != null && (
              <HeroMeta label="Target" value={formatMoney(a.target, a.targetCurrency, { compact: true })} />
            )}
            <HeroMeta label="Currency" value={a.targetCurrency} />
            {a.targetCurrency !== "USD" && (
              <HeroMeta label="≈ USD" value={formatMoney(balUsd, "USD", { compact: true })} />
            )}
          </>
        }
      />


      <SectionTitle>Held across</SectionTitle>
      {byAccount.length === 0 ? (
        <EmptyState title="No funds allocated yet" description="Flag any ledger entry with this allocation to reserve funds." />
      ) : (
        <div className="border border-border rounded-lg bg-card divide-y divide-border overflow-hidden mb-10">
          {byAccount.map(({ objectId, amount }) => {
            const obj = state.objects.find((o) => o.id === objectId);
            if (!obj) return null;
            return (
              <div key={objectId} className="flex items-center gap-4 px-4 py-2.5 text-sm">
                <span className="flex-1 truncate">{obj.name}</span>
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground w-24 truncate">
                  {obj.institution ?? obj.kind}
                </span>
                <span className="num text-sm w-32 text-right">
                  {formatMoney(amount, obj.currency, { signed: true })}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <SectionTitle>Related transactions</SectionTitle>
      {relatedTxns.length === 0 ? (
        <EmptyState title="No transactions" />
      ) : (
        <div className="border border-border rounded-lg bg-card divide-y divide-border overflow-hidden">
          {relatedTxns
            .sort((x, y) => y.date.localeCompare(x.date))
            .map((t) => (
              <TxnRow key={t.id} t={t} />
            ))}
        </div>
      )}
    </PageContainer>
  );
}

export function GoalDetail({ goalId, basePath }: { goalId: string; basePath: string }) {
  const { state } = useLedger();
  const g = state.goals.find((x) => x.id === goalId);
  if (!g) {
    return (
      <PageContainer>
        <BackLink to={basePath + "/goals"} label="Back to goals" />
        <EmptyState title="Goal not found" />
      </PageContainer>
    );
  }
  const progress = goalProgress(state, g.id);
  const current = convert(state, progress.current, "USD", g.currency);
  const linkedAlloc = g.linkedAllocationId
    ? state.allocations.find((a) => a.id === g.linkedAllocationId)
    : null;
  const relatedTxns = state.transactions.filter((t) =>
    t.entries.some(
      (e) => e.goalId === g.id || (g.linkedAllocationId && e.allocationId === g.linkedAllocationId),
    ),
  );
  const deadline = new Date(g.deadline);
  const daysLeft = Math.round((deadline.getTime() - Date.now()) / 86_400_000);

  return (
    <PageContainer>
      <BackLink to={basePath + "/goals"} label="Back to goals" />
      <Hero
        eyebrow={g.priority ? `${g.priority.toUpperCase()} priority goal` : "Goal"}
        title={g.name}
        value={formatMoney(current, g.currency, { compact: true })}
        valueHint={`${Math.round(progress.pct * 100)}% of ${formatMoney(g.target, g.currency, { compact: true })} target`}
        meta={
          <>
            <HeroMeta
              label="Deadline"
              value={deadline.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              tone={daysLeft < 0 ? "neg" : "default"}
            />
            <HeroMeta
              label={daysLeft >= 0 ? "Days left" : "Overdue"}
              value={<span className="num">{Math.abs(daysLeft)}</span>}
              tone={daysLeft < 0 ? "neg" : "default"}
            />
            {linkedAlloc && (
              <HeroMeta
                label="Linked allocation"
                value={
                  <Link
                    to={basePath === "/personal" ? `/personal/allocations/${linkedAlloc.id}` : `/businesses/${g.domainId}/allocations/${linkedAlloc.id}`}
                    className="hover:underline inline-flex items-center gap-1"
                  >
                    {linkedAlloc.name}
                    <ExternalLink className="size-3.5" />
                  </Link>
                }
              />
            )}
          </>
        }
      />

      <div className="mb-10 -mt-2">
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${Math.min(100, progress.pct * 100)}%` }}
          />
        </div>
        <div className="text-xs text-muted-foreground mt-2 num">
          {formatMoney(current, g.currency, { compact: true })} / {formatMoney(g.target, g.currency, { compact: true })}
        </div>
      </div>


      <SectionTitle>Funding history</SectionTitle>
      {relatedTxns.length === 0 ? (
        <EmptyState title="No funding yet" description="Flag any ledger entry with this goal to record progress." />
      ) : (
        <div className="border border-border rounded-lg bg-card divide-y divide-border overflow-hidden">
          {relatedTxns
            .sort((x, y) => y.date.localeCompare(x.date))
            .map((t) => (
              <TxnRow key={t.id} t={t} />
            ))}
        </div>
      )}
    </PageContainer>
  );
}

export function TransactionDetail({ transactionId }: { transactionId: string }) {
  const { state, updateTransaction } = useLedger();
  const t = state.transactions.find((x) => x.id === transactionId);
  if (!t) {
    return (
      <PageContainer>
        <BackLink to="/" label="Back to home" />
        <EmptyState title="Transaction not found" description="This ledger entry doesn't exist." />
      </PageContainer>
    );
  }
  const firstObj = state.objects.find((o) => o.id === t.entries[0]?.objectId);
  const firstDomain = state.domains.find((d) => d.id === firstObj?.domainId);
  const backTo =
    firstDomain?.kind === "personal"
      ? "/personal/transactions"
      : firstDomain
        ? `/businesses/${firstDomain.id}/transactions`
        : "/";

  const currency: CurrencyCode = (firstObj?.currency ?? "USD") as CurrencyCode;
  const total = t.entries
    .filter((e) => e.amount > 0)
    .reduce((s, e) => {
      const o = state.objects.find((x) => x.id === e.objectId);
      return s + (o ? convert(state, e.amount, o.currency, currency) : 0);
    }, 0);

  const voided = t.status === "void";
  const canEditStatus = canPerform("write");

  return (
    <PageContainer>
      <BackLink to={backTo} label="Back" />
      <Hero
        eyebrow={new Date(t.date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        title={t.description}
        value={total > 0 ? formatMoney(total, currency, { compact: true }) : "—"}
        valueTone={voided ? "muted" : "default"}
        valueHint={voided ? "Voided — ignored by every balance" : `${t.entries.length} ${t.entries.length === 1 ? "entry" : "entries"} · ${t.kind.replace("_", " ")}`}
        meta={
          <>
            <HeroMeta
              label="Status"
              value={
                canEditStatus ? (
                  <Select
                    value={t.status ?? "cleared"}
                    onValueChange={(v) => updateTransaction(t.id, { status: v as TransactionStatus })}
                  >
                    <SelectTrigger className="h-7 w-32 capitalize text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((s) => (
                        <SelectItem key={s.value} value={s.value} className="capitalize">
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="capitalize num">{t.status ?? "cleared"}</span>
                )
              }
            />
            <HeroMeta label="Kind" value={<span className="capitalize">{t.kind.replace("_", " ")}</span>} />
            <HeroMeta label="Entries" value={<span className="num">{t.entries.length}</span>} />
          </>
        }
      />

      {voided && (
        <div className="mb-8 border border-border rounded-lg bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          This transaction is voided — it stays in the ledger for the record, but every balance,
          budget, allocation, and goal on this workspace ignores it.
        </div>
      )}


      <SectionTitle>Entries</SectionTitle>
      <div className={["border border-border rounded-lg bg-card divide-y divide-border overflow-hidden mb-10", voided ? "opacity-60" : ""].join(" ")}>
        {t.entries.map((e, i) => {
          const obj = state.objects.find((o) => o.id === e.objectId);
          const cat = e.categoryId ? state.categories.find((c) => c.id === e.categoryId) : null;
          const alloc = e.allocationId ? state.allocations.find((a) => a.id === e.allocationId) : null;
          const goal = e.goalId ? state.goals.find((g) => g.id === e.goalId) : null;
          return (
            <div key={i} className="grid grid-cols-12 gap-4 px-4 py-3 text-sm items-center">
              <div className="col-span-4">
                <div className="font-medium">{obj?.name ?? e.objectId}</div>
                <div className="text-xs text-muted-foreground">{obj?.institution ?? obj?.kind}</div>
              </div>
              <div className="col-span-5 flex flex-wrap gap-2 text-xs">
                {cat && (
                  <span className="border border-border rounded-md px-2 py-0.5 text-muted-foreground">
                    {cat.name}
                  </span>
                )}
                {alloc && (
                  <span className="border border-border rounded-md px-2 py-0.5 text-muted-foreground">
                    ↳ {alloc.name}
                  </span>
                )}
                {goal && (
                  <span className="border border-border rounded-md px-2 py-0.5 text-muted-foreground">
                    ◎ {goal.name}
                  </span>
                )}
              </div>
              <div
                className={[
                  "col-span-3 num text-right",
                  voided ? "" : e.amount > 0 ? "text-pos" : e.amount < 0 ? "text-neg" : "",
                ].join(" ")}
              >
                {obj ? formatMoney(e.amount, obj.currency, { signed: true }) : e.amount}
              </div>
            </div>
          );
        })}
      </div>

      {t.notes && (
        <>
          <SectionTitle>Notes</SectionTitle>
          <p className="text-sm text-muted-foreground">{t.notes}</p>
        </>
      )}
    </PageContainer>
  );
}
