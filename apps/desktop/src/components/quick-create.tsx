import { useSelector } from "@tanstack/react-store";
import { toast } from "sonner";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLedgerActions, useLedgerState, type CurrencyCode, type ObjectKind } from "@/lib/ledger";
import { currentMonthLocal, todayLocal, todayPlusYears } from "@/lib/dates";
import { convert } from "@/lib/ledger";
import { ui, uiStore } from "@/lib/ui-store";
import { CURRENCY_OPTIONS, useAppForm } from "./form-fields";

export type QuickKind =
  | "transaction"
  | "transfer"
  | "account"
  | "liability"
  | "allocation"
  | "goal"
  | "business"
  | "budget";

const labels: Record<QuickKind, string> = {
  transaction: "New Transaction",
  transfer: "New Transfer",
  account: "New Account",
  liability: "New Liability",
  allocation: "New Allocation",
  goal: "New Goal",
  business: "New Business",
  budget: "New Budget",
};

const ASSET_KINDS: ObjectKind[] = ["account", "cash", "wallet", "investment"];
const LIABILITY_KINDS: ObjectKind[] = ["credit_card", "loan", "mortgage"];
const pretty = (k: string) => k.replace("_", " ").replace(/^./, (c) => c.toUpperCase());

const num = z
  .string()
  .refine((v) => v.trim() !== "" && Number.isFinite(Number(v)), "Enter a number");
const nonZero = num.refine((v) => Number(v) !== 0, "Amount can't be zero");
const positive = num.refine((v) => Number(v) > 0, "Must be greater than zero");
const optionalInt = z
  .string()
  .refine((v) => v === "" || Number.isInteger(Number(v)), "Whole number");
const pick = (msg: string) => z.string().min(1, msg);
const optionalNonNegative = z
  .string()
  .refine(
    (v) => v.trim() === "" || (Number.isFinite(Number(v)) && Number(v) >= 0),
    "Must be a positive number",
  );

/** One schema per dialog kind — replaces the try/throw/toast validation. */
const schemas = {
  transaction: z.object({ objectId: pick("Pick an account"), amount: nonZero }),
  transfer: z
    .object({ fromId: pick("Pick a source"), toId: pick("Pick a destination"), amount: positive })
    .refine((v) => v.fromId !== v.toId, { path: ["toId"], message: "Must differ from source" }),
  account: z.object({
    name: z.string().trim().min(1, "Name is required"),
    opening: optionalNonNegative,
  }),
  liability: z.object({
    name: z.string().trim().min(1, "Name is required"),
    dueDay: optionalInt,
    opening: optionalNonNegative,
  }),
  business: z.object({ name: z.string().trim().min(1, "Name is required") }),
  allocation: z.object({ name: z.string().trim().min(1, "Name is required") }),
  goal: z.object({ name: z.string().trim().min(1, "Name is required"), target: positive }),
  budget: z.object({ target: positive, categoryId: pick("Pick a category") }),
} satisfies Record<QuickKind, z.ZodType>;

/** Mounted once (in AppLayout). Driven by `uiStore`, so anything — the topbar
 *  menu, a tab button, the command palette — opens it with `ui.openQuickCreate`. */
export function QuickCreateDialog() {
  const kind = useSelector(uiStore, (s) => s.quickKind);
  if (!kind) return null;
  // Keyed by kind and mounted only while open: every open gets a fresh form,
  // which fixes the stale amount/category leaking into the next dialog.
  return <QuickCreateForm key={kind} kind={kind} />;
}

function QuickCreateForm({ kind }: { kind: QuickKind }) {
  const state = useLedgerState();
  const { addTransaction, addObject, addDomain, addAllocation, addGoal, addBudget } =
    useLedgerActions();
  const defaultDomain = useSelector(uiStore, (s) => s.quickDomainId) ?? "personal";

  const form = useAppForm({
    defaultValues: {
      description: "",
      date: todayLocal(),
      objectId: "",
      fromId: "",
      toId: "",
      amount: "",
      received: "",
      opening: "",
      categoryId: "",
      name: "",
      institution: "",
      kind: (kind === "liability" ? "loan" : "account") as string,
      currency: (kind === "account" || kind === "liability" ? "USD" : "NGN") as string,
      domainId: defaultDomain,
      target: "",
      deadline: "",
      month: currentMonthLocal(),
      interestRate: "",
      minPayment: "",
      creditLimit: "",
      dueDay: "",
    },
    validators: { onSubmit: schemas[kind] as never },
    onSubmit: ({ value: v }) => {
      const ccy = v.currency as CurrencyCode;
      switch (kind) {
        case "transaction":
          addTransaction({
            date: v.date || todayLocal(),
            description: v.description || "Untitled transaction",
            kind: Number(v.amount) >= 0 ? "income" : "expense",
            entries: [
              {
                objectId: v.objectId,
                amount: Number(v.amount),
                categoryId: v.categoryId || undefined,
              },
            ],
          });
          break;
        case "transfer": {
          const from = state.objects.find((o) => o.id === v.fromId)!;
          const to = state.objects.find((o) => o.id === v.toId)!;
          const amt = Math.abs(Number(v.amount));
          // Same currency: one number, two legs. Different currencies: the legs
          // are in different units, so the receiving leg needs its own amount.
          // Writing the same number to both turned 100,000 NGN into 100,000 USD.
          const cross = from.currency !== to.currency;
          const received = cross ? Math.abs(Number(v.received)) : amt;
          if (cross && !(Number.isFinite(received) && received > 0)) {
            toast.error(`Enter the amount received in ${to.currency}`);
            return;
          }
          addTransaction({
            date: v.date || todayLocal(),
            description: v.description || `Transfer: ${from.name} → ${to.name}`,
            kind: cross ? "fx" : "transfer",
            entries: [
              { objectId: from.id, amount: -amt },
              { objectId: to.id, amount: received },
            ],
          });
          break;
        }
        case "account":
        case "liability": {
          const obj = addObject({
            domainId: v.domainId,
            name: v.name.trim(),
            institution: v.institution.trim() || undefined,
            kind: v.kind as ObjectKind,
            currency: ccy,
            ...(kind === "liability" && {
              interestRate: v.interestRate ? Number(v.interestRate) : undefined,
              minPayment: v.minPayment ? Number(v.minPayment) : undefined,
              creditLimit: v.creditLimit ? Number(v.creditLimit) : undefined,
              dueDay: v.dueDay ? Number(v.dueDay) : undefined,
            }),
          });
          const opening = Math.abs(Number(v.opening));
          if (v.opening.trim() !== "" && opening > 0) {
            // Entries are signed: money owed is a NEGATIVE balance. Kind
            // "opening" keeps it out of income in cash-flow reports. Writes run
            // in order (see useLedgerMutation's scope), so the account exists
            // by the time this transaction is saved.
            addTransaction({
              date: todayLocal(),
              description: "Opening balance",
              kind: "opening",
              entries: [{ objectId: obj.id, amount: kind === "liability" ? -opening : opening }],
            });
          }
          break;
        }
        case "business":
          addDomain({ name: v.name.trim(), kind: "business" });
          break;
        case "allocation":
          addAllocation({
            domainId: v.domainId,
            name: v.name.trim(),
            target: v.target ? Number(v.target) : undefined,
            targetCurrency: ccy,
          });
          break;
        case "goal":
          addGoal({
            domainId: v.domainId,
            name: v.name.trim(),
            target: Number(v.target),
            currency: ccy,
            deadline: v.deadline || todayPlusYears(1), // plain YYYY-MM-DD, not a timestamp
            priority: "med",
          });
          break;
        case "budget":
          addBudget({
            domainId: v.domainId,
            month: v.month || currentMonthLocal(),
            currency: ccy,
            lines: [{ categoryId: v.categoryId, amount: Number(v.target) }],
          });
          break;
      }
      toast.success(`${labels[kind].replace("New ", "")} created`);
      ui.closeQuickCreate();
    },
  });

  const objectOptions = state.objects.map((o) => ({ value: o.id, label: o.name }));
  const domainOptions = state.domains.map((d) => ({ value: d.id, label: d.name }));
  // All categories — the old picker only listed ones with a parentId, which
  // onboarding and the seed never create, so it was always empty.
  const categoryOptions = state.categories
    .filter((c) => kind !== "budget" || c.type === "expense")
    .map((c) => ({ value: c.id, label: c.name }));

  return (
    <Dialog open onOpenChange={(o) => !o && ui.closeQuickCreate()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels[kind]}</DialogTitle>
          <DialogDescription>
            Recorded in the workspace ledger — balances derive automatically.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <div className="grid gap-4 py-2">
            {kind === "transaction" && (
              <>
                <form.AppField name="description">
                  {(f) => <f.Text label="Description" placeholder="What was this for?" />}
                </form.AppField>
                <div className="grid grid-cols-2 gap-3">
                  <form.AppField name="date">
                    {(f) => <f.Text label="Date" type="date" />}
                  </form.AppField>
                  <form.AppField name="objectId">
                    {(f) => (
                      <f.Pick label="Account" options={objectOptions} placeholder="Pick account" />
                    )}
                  </form.AppField>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <form.AppField name="amount">
                    {(f) => (
                      <f.Text
                        label="Amount (signed)"
                        type="number"
                        step="0.01"
                        placeholder="Negative = money out"
                      />
                    )}
                  </form.AppField>
                  <form.AppField name="categoryId">
                    {(f) => <f.Pick label="Category (optional)" options={categoryOptions} />}
                  </form.AppField>
                </div>
              </>
            )}

            {kind === "transfer" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <form.AppField name="fromId">
                    {(f) => <f.Pick label="From" options={objectOptions} />}
                  </form.AppField>
                  <form.AppField name="toId">
                    {(f) => <f.Pick label="To" options={objectOptions} />}
                  </form.AppField>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <form.AppField name="amount">
                    {(f) => <f.Text label="Amount" type="number" step="0.01" />}
                  </form.AppField>
                  <form.AppField name="date">
                    {(f) => <f.Text label="Date" type="date" />}
                  </form.AppField>
                </div>
                <form.Subscribe
                  selector={(st) => [st.values.fromId, st.values.toId, st.values.amount] as const}
                >
                  {([fromId, toId, amount]) => {
                    const from = state.objects.find((o) => o.id === fromId);
                    const to = state.objects.find((o) => o.id === toId);
                    if (!from || !to || from.currency === to.currency) return null;
                    const n = Number(amount);
                    const hint =
                      Number.isFinite(n) && n > 0
                        ? Math.round(convert(state, n, from.currency, to.currency) * 100) / 100
                        : undefined;
                    return (
                      <div className="grid gap-1.5">
                        <form.AppField name="received">
                          {(f) => (
                            <f.Text
                              label={`Amount received (${to.currency})`}
                              type="number"
                              step="0.01"
                            />
                          )}
                        </form.AppField>
                        <p className="text-xs text-muted-foreground">
                          These accounts hold different currencies, so enter what actually arrived
                          {hint !== undefined ? ` (at your saved rate, about ${hint}).` : "."}
                        </p>
                      </div>
                    );
                  }}
                </form.Subscribe>
                <form.AppField name="description">
                  {(f) => <f.Text label="Note (optional)" />}
                </form.AppField>
              </>
            )}

            {(kind === "account" || kind === "liability") && (
              <>
                <form.AppField name="name">
                  {(f) => <f.Text label="Name" placeholder="Account name" />}
                </form.AppField>
                <div className="grid grid-cols-2 gap-3">
                  <form.AppField name="institution">
                    {(f) => <f.Text label="Institution" />}
                  </form.AppField>
                  <form.AppField name="currency">
                    {(f) => <f.Pick label="Currency" options={CURRENCY_OPTIONS} />}
                  </form.AppField>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <form.AppField name="kind">
                    {(f) => (
                      <f.Pick
                        label="Type"
                        options={(kind === "liability" ? LIABILITY_KINDS : ASSET_KINDS).map(
                          (k) => ({ value: k, label: pretty(k) }),
                        )}
                      />
                    )}
                  </form.AppField>
                  <form.AppField name="domainId">
                    {(f) => <f.Pick label="Domain" options={domainOptions} />}
                  </form.AppField>
                </div>
                <form.AppField name="opening">
                  {(f) => (
                    <f.Text
                      label={kind === "liability" ? "Amount currently owed" : "Opening balance"}
                      type="number"
                      step="0.01"
                    />
                  )}
                </form.AppField>
                {kind === "liability" && (
                  <div className="grid grid-cols-2 gap-3">
                    <form.AppField name="interestRate">
                      {(f) => <f.Text label="Interest rate %" type="number" step="0.01" />}
                    </form.AppField>
                    <form.AppField name="minPayment">
                      {(f) => <f.Text label="Min payment" type="number" step="0.01" />}
                    </form.AppField>
                    <form.AppField name="creditLimit">
                      {(f) => <f.Text label="Credit limit" type="number" step="0.01" />}
                    </form.AppField>
                    <form.AppField name="dueDay">
                      {(f) => <f.Text label="Due day (1–31)" type="number" />}
                    </form.AppField>
                  </div>
                )}
              </>
            )}

            {kind === "business" && (
              <form.AppField name="name">
                {(f) => <f.Text label="Business name" placeholder="Business name" />}
              </form.AppField>
            )}

            {(kind === "allocation" || kind === "goal" || kind === "budget") && (
              <>
                {kind !== "budget" && (
                  <form.AppField name="name">{(f) => <f.Text label="Name" />}</form.AppField>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <form.AppField name="target">
                    {(f) => (
                      <f.Text
                        label={kind === "budget" ? "Monthly amount" : "Target amount"}
                        type="number"
                      />
                    )}
                  </form.AppField>
                  <form.AppField name="currency">
                    {(f) => <f.Pick label="Currency" options={CURRENCY_OPTIONS} />}
                  </form.AppField>
                </div>
                <form.AppField name="domainId">
                  {(f) => <f.Pick label="Domain" options={domainOptions} />}
                </form.AppField>
                {kind === "goal" && (
                  <form.AppField name="deadline">
                    {(f) => <f.Text label="Deadline" type="date" />}
                  </form.AppField>
                )}
                {kind === "budget" && (
                  <>
                    <form.AppField name="categoryId">
                      {(f) => <f.Pick label="Category" options={categoryOptions} />}
                    </form.AppField>
                    <form.AppField name="month">
                      {(f) => <f.Text label="Month" type="month" />}
                    </form.AppField>
                  </>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={ui.closeQuickCreate}>
              Cancel
            </Button>
            <form.AppForm>
              <form.SubmitButton>Save</form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
