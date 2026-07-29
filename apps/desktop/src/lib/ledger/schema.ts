// Runtime validation for persisted ledger snapshots. Zod guards us against a
// corrupted or stale localStorage blob crashing the app on boot.
import { z } from "zod";

export const LEDGER_SCHEMA_VERSION = 1;

const currency = z.enum(["NGN", "USD", "GBP", "EUR"]);

const domain = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["personal", "business", "trading"]),
  displayCurrency: currency.optional(),
  description: z.string().optional(),
});

const financialObject = z.object({
  id: z.string(),
  domainId: z.string(),
  name: z.string(),
  institution: z.string().optional(),
  kind: z.enum(["account", "cash", "wallet", "investment", "credit_card", "loan", "mortgage"]),
  currency,
  interestRate: z.number().optional(),
  minPayment: z.number().optional(),
  creditLimit: z.number().optional(),
  dueDay: z.number().int().min(1).max(31).optional(),
});

const category = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().optional(),
  type: z.enum(["income", "expense"]),
});

const allocation = z.object({
  id: z.string(),
  domainId: z.string(),
  name: z.string(),
  target: z.number().optional(),
  targetCurrency: currency,
});

const goal = z.object({
  id: z.string(),
  domainId: z.string(),
  name: z.string(),
  target: z.number(),
  currency,
  deadline: z.string(),
  priority: z.enum(["low", "med", "high"]).optional(),
  linkedAllocationId: z.string().optional(),
  notes: z.string().optional(),
});

const budget = z.object({
  id: z.string(),
  domainId: z.string(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  currency,
  lines: z.array(z.object({ categoryId: z.string(), amount: z.number() })),
});

const entry = z.object({
  objectId: z.string(),
  amount: z.number().finite(),
  categoryId: z.string().optional(),
  allocationId: z.string().optional(),
  goalId: z.string().optional(),
});

const transaction = z.object({
  id: z.string(),
  date: z.string(),
  description: z.string(),
  kind: z.enum(["income", "expense", "transfer", "loan_disbursement", "loan_repayment", "interest", "fx"]),
  status: z.enum(["cleared", "pending", "reconciled", "void"]).optional(),
  notes: z.string().optional(),
  entries: z.array(entry).min(1),
});

const fxRate = z.object({
  base: currency,
  quote: currency,
  rate: z.number().positive(),
});

const settings = z.object({
  workspaceName: z.string(),
  defaultCurrency: currency,
  fiscalYearStart: z.enum([
    "January","February","March","April","May","June",
    "July","August","September","October","November","December",
  ]),
  timezone: z.string(),
  theme: z.enum(["light","dark","system"]),
  density: z.enum(["comfortable","compact"]),
});

export const ledgerStateSchema = z.object({
  currencies: z.array(currency),
  fx: z.array(fxRate),
  domains: z.array(domain),
  objects: z.array(financialObject),
  categories: z.array(category),
  allocations: z.array(allocation),
  goals: z.array(goal),
  budgets: z.array(budget),
  transactions: z.array(transaction),
  settings: settings.optional(),
});

export const persistedSnapshotSchema = z.object({
  version: z.literal(LEDGER_SCHEMA_VERSION),
  state: ledgerStateSchema,
});

export type PersistedSnapshot = z.infer<typeof persistedSnapshotSchema>;
