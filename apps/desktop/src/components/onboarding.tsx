import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useLedger, type CurrencyCode } from "@/lib/ledger";
import type { LedgerState, ObjectKind } from "@/lib/ledger/types";
import {
  loadOnboarding,
  setOnboardingComplete,
  loadDisplayName,
  saveDisplayName,
  startTour,
} from "@/lib/local-store";
import { toast } from "sonner";
import {
  Check,
  ChevronRight,
  ChevronLeft,
  Plus,
  Trash2,
  Wallet,
  Landmark,
  CreditCard,
  Coins,
  TrendingUp,
  Sparkles,
} from "lucide-react";

// Full-screen first-run wizard. Focused on what the user actually needs to
// choose to start using the app: currency, categories, accounts. Workspace
// naming, domain naming, and PIN setup are deferred to Settings.

const CURRENCIES: { code: CurrencyCode; label: string; symbol: string }[] = [
  { code: "NGN", label: "Nigerian Naira", symbol: "₦" },
  { code: "USD", label: "US Dollar", symbol: "$" },
  { code: "GBP", label: "British Pound", symbol: "£" },
  { code: "EUR", label: "Euro", symbol: "€" },
];

const ACCOUNT_KINDS: {
  value: ObjectKind;
  label: string;
  icon: typeof Wallet;
}[] = [
  { value: "account", label: "Bank account", icon: Landmark },
  { value: "cash", label: "Cash", icon: Coins },
  { value: "wallet", label: "Wallet", icon: Wallet },
  { value: "credit_card", label: "Credit card", icon: CreditCard },
  { value: "investment", label: "Investment", icon: TrendingUp },
  { value: "loan", label: "Loan", icon: Landmark },
];

type CategoryDraft = {
  name: string;
  type: "income" | "expense";
  enabled: boolean;
};

type CategoryGroup = {
  id: string;
  label: string;
  hint: string;
  categories: CategoryDraft[];
};

const CATEGORY_GROUPS: CategoryGroup[] = [
  {
    id: "income",
    label: "Income",
    hint: "Where money comes from",
    categories: [
      { name: "Salary", type: "income", enabled: true },
      { name: "Freelance", type: "income", enabled: true },
      { name: "Investments", type: "income", enabled: false },
      { name: "Gifts", type: "income", enabled: false },
    ],
  },
  {
    id: "essentials",
    label: "Essentials",
    hint: "Bills and living costs",
    categories: [
      { name: "Rent", type: "expense", enabled: true },
      { name: "Utilities", type: "expense", enabled: true },
      { name: "Groceries", type: "expense", enabled: true },
      { name: "Transport", type: "expense", enabled: true },
      { name: "Healthcare", type: "expense", enabled: false },
      { name: "Insurance", type: "expense", enabled: false },
    ],
  },
  {
    id: "lifestyle",
    label: "Lifestyle",
    hint: "Discretionary spending",
    categories: [
      { name: "Dining", type: "expense", enabled: true },
      { name: "Entertainment", type: "expense", enabled: true },
      { name: "Shopping", type: "expense", enabled: false },
      { name: "Travel", type: "expense", enabled: false },
      { name: "Subscriptions", type: "expense", enabled: false },
    ],
  },
  {
    id: "financial",
    label: "Financial",
    hint: "Savings, debt, taxes",
    categories: [
      { name: "Savings", type: "expense", enabled: false },
      { name: "Loan payment", type: "expense", enabled: false },
      { name: "Taxes", type: "expense", enabled: false },
      { name: "Fees", type: "expense", enabled: false },
    ],
  },
];

type DraftAccount = {
  name: string;
  kind: ObjectKind;
  currency: CurrencyCode;
  balance: string;
  institution?: string;
};

function rid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function OnboardingGate({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<boolean | null>(null); // null = checking

  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      loadOnboarding().then((s) => {
        if (!cancelled) setOpen(!s.complete);
      });
    };
    sync();
    window.addEventListener("ledgerone:onboarding-changed", sync);
    return () => {
      cancelled = true;
      window.removeEventListener("ledgerone:onboarding-changed", sync);
    };
  }, []);

  if (open === null) return <div className="h-full bg-background" />;

  return (
    <>
      {children}
      {open && <OnboardingWizard onDone={() => setOpen(false)} />}
    </>
  );
}

function OnboardingWizard({ onDone }: { onDone: () => void }) {
  const { state, replaceState, ready } = useLedger();
  const [step, setStep] = useState(0);

  // Display name — just what the app calls the user. Nickname is fine.
  const [displayName, setDisplayName] = useState<string>(() => loadDisplayName());

  // Currency — the app's foundation.
  const [defaultCurrency, setDefaultCurrency] = useState<CurrencyCode>("USD");
  const [enabledCurrencies, setEnabledCurrencies] = useState<CurrencyCode[]>([
    "USD",
  ]);

  // Categories — grouped for scan-ability.
  const [groups, setGroups] = useState<CategoryGroup[]>(() =>
    // Deep clone so state mutations don't leak into the module-level default.
    CATEGORY_GROUPS.map((g) => ({
      ...g,
      categories: g.categories.map((c) => ({ ...c })),
    })),
  );

  // Accounts — start empty. Users add what they actually have.
  const [accounts, setAccounts] = useState<DraftAccount[]>([]);

  const steps = ["Welcome", "Name", "Currency", "Categories", "Accounts", "Finish"] as const;

  const canNext = (() => {
    if (step === 1) return displayName.trim().length > 0;
    if (step === 2) return enabledCurrencies.length > 0;
    if (step === 4)
      return accounts.every((a) => a.name.trim().length > 0);
    return true;
  })();

  const selectedCategoryCount = useMemo(
    () =>
      groups.reduce(
        (sum, g) => sum + g.categories.filter((c) => c.enabled).length,
        0,
      ),
    [groups],
  );

  async function finish(skip = false) {
    try {
      if (!skip) {
        const personalDomainId = "personal";

        const objects = accounts
          .filter((a) => a.name.trim().length > 0)
          .map((a) => ({
            id: rid("obj"),
            domainId: personalDomainId,
            name: a.name.trim(),
            institution: a.institution?.trim() || undefined,
            kind: a.kind,
            currency: a.currency,
          }));

        const cats = groups.flatMap((g) =>
          g.categories
            .filter((c) => c.enabled && c.name.trim().length > 0)
            .map((c) => ({
              id: rid("cat"),
              name: c.name.trim(),
              type: c.type,
            })),
        );

        // Opening balance transactions for accounts with non-zero balances.
        const openingTxs = accounts
          .map((a, i) => {
            if (!a.name.trim()) return null;
            const amt = Number(a.balance);
            if (!Number.isFinite(amt) || amt === 0) return null;
            return {
              id: rid("tx"),
              date: new Date().toISOString().slice(0, 10),
              description: "Opening balance",
              kind: "income" as const,
              status: "cleared" as const,
              entries: [{ objectId: objects[i].id, amount: amt }],
            };
          })
          .filter((t): t is NonNullable<typeof t> => t != null);

        const currencies = enabledCurrencies.includes(defaultCurrency)
          ? enabledCurrencies
          : [defaultCurrency, ...enabledCurrencies];

        const next: LedgerState = {
          currencies,
          fx: state.fx ?? [],
          domains: [
            { id: personalDomainId, name: "Personal", kind: "personal" },
          ],
          objects,
          categories: cats,
          allocations: [],
          goals: [],
          budgets: [],
          transactions: openingTxs,
          settings: {
            workspaceName: state.settings?.workspaceName ?? "My Workspace",
            defaultCurrency,
            fiscalYearStart: state.settings?.fiscalYearStart ?? "January",
            timezone: state.settings?.timezone ?? "UTC",
            theme: state.settings?.theme ?? "light",
            density: state.settings?.density ?? "comfortable",
          },
        };

        await replaceState(next);
        saveDisplayName(displayName);
      }

      await setOnboardingComplete();
      if (!skip) await startTour();
      toast.success(skip ? "You can set things up later" : `Welcome, ${displayName.trim() || "friend"}`);
      onDone();
    } catch (err) {
      console.error("[onboarding] finish failed:", err);
      toast.error("Failed to save workspace");
    }
  }

  if (!ready) return null;

  return (
    // z-50 keeps Radix Select portals (also z-50, appended later in the DOM)
    // stacked ABOVE the overlay. Previously the overlay was z-9998, so
    // dropdown popovers rendered underneath the modal and appeared broken.
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-xl overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-10">
        {/* Progress rail */}
        <div className="mb-10 flex items-center gap-2">
          {steps.map((label, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <div key={label} className="flex-1">
                <div
                  className={`h-1 rounded-full transition-colors duration-300 ${
                    done
                      ? "bg-primary"
                      : active
                        ? "bg-primary/60"
                        : "bg-muted"
                  }`}
                />
                <div
                  className={`mt-2 text-[10px] uppercase tracking-widest text-center transition-colors ${
                    active
                      ? "text-foreground"
                      : done
                        ? "text-primary"
                        : "text-muted-foreground"
                  }`}
                >
                  {label}
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-2xl border bg-card p-8 shadow-sm min-h-[420px]">
          {step === 0 && <StepWelcome />}

          {step === 1 && (
            <StepName value={displayName} onChange={setDisplayName} />
          )}

          {step === 2 && (
            <StepCurrency
              defaultCurrency={defaultCurrency}
              enabledCurrencies={enabledCurrencies}
              onDefaultChange={(c) => {
                setDefaultCurrency(c);
                setEnabledCurrencies((prev) =>
                  prev.includes(c) ? prev : [...prev, c],
                );
              }}
              onToggle={(c) =>
                setEnabledCurrencies((prev) => {
                  const on = prev.includes(c);
                  if (on && c === defaultCurrency) return prev; // can't disable default
                  return on ? prev.filter((x) => x !== c) : [...prev, c];
                })
              }
            />
          )}

          {step === 3 && (
            <StepCategories
              groups={groups}
              onToggle={(gi, ci) =>
                setGroups((prev) =>
                  prev.map((g, i) =>
                    i === gi
                      ? {
                          ...g,
                          categories: g.categories.map((c, j) =>
                            j === ci ? { ...c, enabled: !c.enabled } : c,
                          ),
                        }
                      : g,
                  ),
                )
              }
              onToggleGroup={(gi, enabled) =>
                setGroups((prev) =>
                  prev.map((g, i) =>
                    i === gi
                      ? {
                          ...g,
                          categories: g.categories.map((c) => ({
                            ...c,
                            enabled,
                          })),
                        }
                      : g,
                  ),
                )
              }
              onAdd={(gi, type) =>
                setGroups((prev) =>
                  prev.map((g, i) =>
                    i === gi
                      ? {
                          ...g,
                          categories: [
                            ...g.categories,
                            { name: "", type, enabled: true },
                          ],
                        }
                      : g,
                  ),
                )
              }
              onRename={(gi, ci, name) =>
                setGroups((prev) =>
                  prev.map((g, i) =>
                    i === gi
                      ? {
                          ...g,
                          categories: g.categories.map((c, j) =>
                            j === ci ? { ...c, name } : c,
                          ),
                        }
                      : g,
                  ),
                )
              }
              onRemove={(gi, ci) =>
                setGroups((prev) =>
                  prev.map((g, i) =>
                    i === gi
                      ? {
                          ...g,
                          categories: g.categories.filter((_, j) => j !== ci),
                        }
                      : g,
                  ),
                )
              }
              totalSelected={selectedCategoryCount}
            />
          )}

          {step === 4 && (
            <StepAccounts
              accounts={accounts}
              enabledCurrencies={enabledCurrencies}
              defaultCurrency={defaultCurrency}
              onChange={setAccounts}
            />
          )}

          {step === 5 && (
            <StepFinish
              defaultCurrency={defaultCurrency}
              enabledCurrencies={enabledCurrencies}
              accountsCount={accounts.filter((a) => a.name.trim()).length}
              categoriesCount={selectedCategoryCount}
            />
          )}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <Button variant="ghost" onClick={() => finish(true)}>
            Skip for now
          </Button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button
                variant="outline"
                onClick={() => setStep((s) => s - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
            )}
            {step < steps.length - 1 ? (
              <Button
                disabled={!canNext}
                onClick={() => setStep((s) => s + 1)}
              >
                Continue
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={() => finish(false)}>
                <Sparkles className="h-4 w-4" />
                Enter workspace
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Step components
// -----------------------------------------------------------------------------

function StepWelcome() {
  return (
    <div className="space-y-6">
      <div className="inline-flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 text-xs uppercase tracking-widest text-muted-foreground">
        <Sparkles className="h-3 w-3" />
        Welcome
      </div>
      <h1 className="text-3xl font-semibold tracking-tight">
        A ledger that stays on your device.
      </h1>
      <p className="text-muted-foreground leading-relaxed">
        A few quick choices and you're in. Tell us what to call you, pick your
        currencies, choose categories to track, and add any accounts you have.
        Everything can be changed later from Settings.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
        {[
          { n: "1", t: "Name", d: "What to call you" },
          { n: "2", t: "Currency", d: "Default + others" },
          { n: "3", t: "Categories", d: "What to track" },
          { n: "4", t: "Accounts", d: "Optional to start" },
        ].map((s) => (
          <div
            key={s.n}
            className="rounded-lg border bg-muted/20 p-4"
          >
            <div className="text-2xl font-mono text-muted-foreground">
              {s.n}
            </div>
            <div className="mt-2 text-sm font-medium">{s.t}</div>
            <div className="text-xs text-muted-foreground">{s.d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepName({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-6">
      <Header
        title="What should we call you?"
        hint="This is just how the app greets you. A nickname, first name, initials, or something you made up all work — it stays on this device."
      />
      <div className="space-y-2">
        <Label htmlFor="onboarding-display-name">Display name</Label>
        <Input
          id="onboarding-display-name"
          autoFocus
          placeholder="e.g. Alex, Sam, Kiwi, Money Boss"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={40}
        />
        <p className="text-xs text-muted-foreground">
          Not tied to any account. You can change or remove it anytime in Settings.
        </p>
      </div>
      {value.trim() && (
        <div className="rounded-lg border bg-muted/20 p-4 flex items-center gap-3">
          <div className="size-9 rounded-full bg-primary/15 text-primary grid place-items-center text-sm font-semibold">
            {value.trim()[0]?.toUpperCase() ?? "•"}
          </div>
          <div className="text-sm">
            <span className="text-muted-foreground">Preview: </span>
            <span className="font-medium">Hi, {value.trim()} 👋</span>
          </div>
        </div>
      )}
    </div>
  );
}


function StepCurrency({
  defaultCurrency,
  enabledCurrencies,
  onDefaultChange,
  onToggle,
}: {
  defaultCurrency: CurrencyCode;
  enabledCurrencies: CurrencyCode[];
  onDefaultChange: (c: CurrencyCode) => void;
  onToggle: (c: CurrencyCode) => void;
}) {
  return (
    <div className="space-y-6">
      <Header
        title="Currency"
        hint="Your default currency is used for reports and totals. Enable extras if you hold or spend in more than one."
      />

      <div className="space-y-2">
        <Label>Default currency</Label>
        <Select value={defaultCurrency} onValueChange={(v) => onDefaultChange(v as CurrencyCode)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CURRENCIES.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                <span className="font-mono text-muted-foreground mr-2">
                  {c.symbol}
                </span>
                {c.code} — {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Additional currencies</Label>
        <div className="grid grid-cols-2 gap-2">
          {CURRENCIES.map((c) => {
            const on = enabledCurrencies.includes(c.code);
            const isDefault = c.code === defaultCurrency;
            return (
              <button
                key={c.code}
                type="button"
                onClick={() => onToggle(c.code)}
                disabled={isDefault}
                className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  on
                    ? "bg-primary/10 border-primary/40"
                    : "bg-background hover:bg-muted"
                } ${isDefault ? "opacity-100 cursor-default" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono w-6 text-center">
                    {c.symbol}
                  </span>
                  <div>
                    <div className="text-sm font-medium">{c.code}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.label}
                    </div>
                  </div>
                </div>
                {on && (
                  <div className="flex items-center gap-1.5">
                    {isDefault && (
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Default
                      </span>
                    )}
                    <Check className="h-4 w-4 text-primary" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StepCategories({
  groups,
  onToggle,
  onToggleGroup,
  onAdd,
  onRename,
  onRemove,
  totalSelected,
}: {
  groups: CategoryGroup[];
  onToggle: (gi: number, ci: number) => void;
  onToggleGroup: (gi: number, enabled: boolean) => void;
  onAdd: (gi: number, type: "income" | "expense") => void;
  onRename: (gi: number, ci: number, name: string) => void;
  onRemove: (gi: number, ci: number) => void;
  totalSelected: number;
}) {
  return (
    <div className="space-y-6">
      <Header
        title="Categories"
        hint="Group your money into buckets. Pick the ones you'll actually use — you can add or remove any of these later."
        aside={`${totalSelected} selected`}
      />

      <div className="space-y-5">
        {groups.map((g, gi) => {
          const enabledCount = g.categories.filter((c) => c.enabled).length;
          const allOn = enabledCount === g.categories.length && enabledCount > 0;
          return (
            <div key={g.id} className="space-y-2">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-sm font-semibold">{g.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {g.hint}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onToggleGroup(gi, !allOn)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {allOn ? "Clear all" : "Select all"}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {g.categories.map((c, ci) => (
                  <div
                    key={ci}
                    className={`group inline-flex items-center gap-1 rounded-full border pl-2 pr-1 py-0.5 text-sm transition-colors ${
                      c.enabled
                        ? "bg-primary/10 border-primary/40 text-foreground"
                        : "bg-background border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onToggle(gi, ci)}
                      className="inline-flex items-center gap-1.5 py-1"
                    >
                      {c.enabled ? (
                        <Check className="h-3 w-3 text-primary" />
                      ) : (
                        <span className="h-3 w-3 rounded-full border border-muted-foreground/40" />
                      )}
                      <input
                        value={c.name}
                        onChange={(e) => onRename(gi, ci, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="bg-transparent outline-none w-auto min-w-[3ch] text-sm"
                        style={{ width: `${Math.max(c.name.length, 3)}ch` }}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(gi, ci)}
                      className="opacity-0 group-hover:opacity-100 rounded-full p-0.5 hover:bg-destructive/10 hover:text-destructive transition"
                      aria-label="Remove category"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => onAdd(gi, g.id === "income" ? "income" : "expense")}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/40 transition"
                >
                  <Plus className="h-3 w-3" />
                  Add
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StepAccounts({
  accounts,
  enabledCurrencies,
  defaultCurrency,
  onChange,
}: {
  accounts: DraftAccount[];
  enabledCurrencies: CurrencyCode[];
  defaultCurrency: CurrencyCode;
  onChange: (next: DraftAccount[]) => void;
}) {
  return (
    <div className="space-y-6">
      <Header
        title="Accounts"
        hint="Add any accounts, cards, or wallets you'd like to track. You can leave this empty and add them later."
        aside={accounts.length ? `${accounts.length} added` : "Optional"}
      />

      {accounts.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <Wallet className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            No accounts yet. Add one to start tracking balances.
          </p>
          <div className="mt-4 flex justify-center gap-2 flex-wrap">
            {ACCOUNT_KINDS.slice(0, 4).map((k) => (
              <Button
                key={k.value}
                variant="outline"
                size="sm"
                onClick={() =>
                  onChange([
                    ...accounts,
                    {
                      name: "",
                      kind: k.value,
                      currency: defaultCurrency,
                      balance: "0",
                    },
                  ])
                }
              >
                <k.icon className="h-4 w-4" />
                {k.label}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((a, i) => {
            const KindIcon =
              ACCOUNT_KINDS.find((k) => k.value === a.kind)?.icon ?? Wallet;
            return (
              <div
                key={i}
                className="rounded-lg border bg-muted/10 p-3 space-y-3"
              >
                <div className="flex items-center gap-2">
                  <div className="rounded-md bg-muted p-2">
                    <KindIcon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <Input
                    placeholder="Account name (e.g. Chase Checking)"
                    value={a.name}
                    onChange={(e) => {
                      const v = e.target.value;
                      onChange(
                        accounts.map((x, j) =>
                          j === i ? { ...x, name: v } : x,
                        ),
                      );
                    }}
                    className="flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      onChange(accounts.filter((_, j) => j !== i))
                    }
                    aria-label="Remove account"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Type
                    </Label>
                    <Select
                      value={a.kind}
                      onValueChange={(v) =>
                        onChange(
                          accounts.map((x, j) =>
                            j === i ? { ...x, kind: v as ObjectKind } : x,
                          ),
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ACCOUNT_KINDS.map((k) => (
                          <SelectItem key={k.value} value={k.value}>
                            <k.icon className="h-3.5 w-3.5 text-muted-foreground mr-1.5 inline" />
                            {k.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Currency
                    </Label>
                    <Select
                      value={a.currency}
                      onValueChange={(v) =>
                        onChange(
                          accounts.map((x, j) =>
                            j === i
                              ? { ...x, currency: v as CurrencyCode }
                              : x,
                          ),
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(enabledCurrencies.length
                          ? enabledCurrencies
                          : [defaultCurrency]
                        ).map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Balance
                    </Label>
                    <Input
                      type="number"
                      placeholder="0"
                      value={a.balance}
                      onChange={(e) => {
                        const v = e.target.value;
                        onChange(
                          accounts.map((x, j) =>
                            j === i ? { ...x, balance: v } : x,
                          ),
                        );
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              onChange([
                ...accounts,
                {
                  name: "",
                  kind: "account",
                  currency: defaultCurrency,
                  balance: "0",
                },
              ])
            }
          >
            <Plus className="h-4 w-4" />
            Add another account
          </Button>
        </div>
      )}
    </div>
  );
}

function StepFinish({
  defaultCurrency,
  enabledCurrencies,
  accountsCount,
  categoriesCount,
}: {
  defaultCurrency: CurrencyCode;
  enabledCurrencies: CurrencyCode[];
  accountsCount: number;
  categoriesCount: number;
}) {
  return (
    <div className="space-y-6">
      <Header
        title="Ready when you are"
        hint="Here's what we're setting up. You can change any of this from Settings."
      />
      <div className="rounded-lg border divide-y">
        <SummaryRow
          label="Default currency"
          value={defaultCurrency}
        />
        <SummaryRow
          label="Enabled currencies"
          value={enabledCurrencies.join(", ") || "—"}
        />
        <SummaryRow
          label="Categories"
          value={`${categoriesCount} selected`}
        />
        <SummaryRow
          label="Accounts"
          value={accountsCount ? `${accountsCount} added` : "None yet"}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Set a PIN, rename your workspace, or add businesses from{" "}
        <span className="font-medium text-foreground">Settings</span> once
        you're in.
      </p>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Primitives
// -----------------------------------------------------------------------------

function Header({
  title,
  hint,
  aside,
}: {
  title: string;
  hint: string;
  aside?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground max-w-md">{hint}</p>
      </div>
      {aside && (
        <div className="text-xs uppercase tracking-widest text-muted-foreground shrink-0 pt-1">
          {aside}
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center gap-4 px-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-right">{value}</span>
    </div>
  );
}
