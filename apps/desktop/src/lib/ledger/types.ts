// LedgerOne: single source of truth. Everything derives from `transactions`.
// Domains organize objects; the ledger itself is workspace-wide.

export type CurrencyCode = "NGN" | "USD" | "GBP" | "EUR";

export type DomainKind = "personal" | "business" | "trading";
export type Domain = {
  id: string;
  name: string;
  kind: DomainKind;
  /** Optional per-domain reporting currency. Falls back to workspace defaultCurrency. */
  displayCurrency?: CurrencyCode;
  /** Optional short description shown in the domain settings tab. */
  description?: string;
};

export type ObjectKind =
  | "account"
  | "cash"
  | "wallet"
  | "investment"
  | "credit_card"
  | "loan"
  | "mortgage";

export type FinancialObject = {
  id: string;
  domainId: string;
  name: string;
  institution?: string;
  kind: ObjectKind;
  currency: CurrencyCode;
  /** Optional metadata for liabilities */
  interestRate?: number;
  minPayment?: number;
  creditLimit?: number;
  dueDay?: number; // 1-31
};

export type Category = {
  id: string;
  name: string;
  parentId?: string;
  type: "income" | "expense";
};

export type Allocation = {
  id: string;
  domainId: string;
  name: string;
  target?: number;
  targetCurrency: CurrencyCode;
};

export type Goal = {
  id: string;
  domainId: string;
  name: string;
  target: number;
  currency: CurrencyCode;
  deadline: string; // ISO
  priority?: "low" | "med" | "high";
  linkedAllocationId?: string;
  notes?: string;
};

export type BudgetLine = {
  categoryId: string;
  amount: number;
};
export type Budget = {
  id: string;
  domainId: string;
  month: string; // YYYY-MM
  currency: CurrencyCode;
  lines: BudgetLine[];
};

export type Entry = {
  objectId: string;
  amount: number; // signed, in object's native currency
  categoryId?: string;
  allocationId?: string;
  goalId?: string;
};

/** Mirrors `TransactionStatus` in packages/db/src/schema.ts (the DB's CHECK
 *  constraint enforces this same vocabulary). Missing/undefined is treated
 *  as `"cleared"` everywhere. `"void"` is the only status excluded from
 *  balance selectors (see balanceOf/domainMetrics/etc. in selectors.ts) —
 *  it stays visible in transaction lists so voiding something leaves an
 *  audit trail instead of silently deleting it. */
export type TransactionStatus = "pending" | "cleared" | "reconciled" | "void";

export type Transaction = {
  id: string;
  date: string; // ISO date
  description: string;
  kind:
    | "income"
    | "expense"
    | "transfer"
    | "loan_disbursement"
    | "loan_repayment"
    | "interest"
    | "fx";
  status?: TransactionStatus;
  notes?: string;
  entries: Entry[];
};

export type FxRate = {
  base: CurrencyCode;
  quote: CurrencyCode;
  rate: number;
};

export type WorkspaceSettings = {
  workspaceName: string;
  defaultCurrency: CurrencyCode;
  fiscalYearStart:
    | "January" | "February" | "March" | "April" | "May" | "June"
    | "July" | "August" | "September" | "October" | "November" | "December";
  timezone: string;
  theme: "light" | "dark" | "system";
  density: "comfortable" | "compact";
};

export type LedgerState = {
  currencies: CurrencyCode[];
  fx: FxRate[]; // to USD (base)
  domains: Domain[];
  objects: FinancialObject[];
  categories: Category[];
  allocations: Allocation[];
  goals: Goal[];
  budgets: Budget[];
  transactions: Transaction[];
  settings?: WorkspaceSettings;
};
