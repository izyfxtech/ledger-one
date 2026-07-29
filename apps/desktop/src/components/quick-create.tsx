import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLedger, type CurrencyCode } from "@/lib/ledger";

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

export function QuickCreateDialog({
  kind,
  onClose,
  defaultDomain,
}: {
  kind: QuickKind | null;
  onClose: () => void;
  defaultDomain?: string;
}) {
  const {
    state,
    addTransaction,
    addObject,
    addDomain,
    addAllocation,
    addGoal,
    addBudget,
  } = useLedger();
  const [form, setForm] = useState<Record<string, any>>({});
  // Plain YYYY-MM-DD, matching every other date in the ledger (seed data,
  // goal deadlines, budget months) — not a full timestamp. Transaction and
  // Transfer used to have no date field at all and silently fell back to
  // `new Date().toISOString()` (a full timestamp) at submit time, which is
  // why some rows in the ledger have times attached and most don't.
  const todayStr = new Date().toISOString().slice(0, 10);

  if (!kind) return null;

  const setF = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const submit = () => {
    try {
      if (kind === "transaction") {
        const obj = state.objects.find((o) => o.id === form.objectId);
        if (!obj || !form.amount) throw new Error("Pick an account and amount");
        addTransaction({
          date: (form.date as string) || todayStr,
          description: form.description || "Untitled transaction",
          kind: Number(form.amount) >= 0 ? "income" : "expense",
          entries: [
            { objectId: obj.id, amount: Number(form.amount), categoryId: form.categoryId || undefined },
          ],
        });
        toast.success("Transaction recorded");
      } else if (kind === "transfer") {
        const from = state.objects.find((o) => o.id === form.fromId);
        const to = state.objects.find((o) => o.id === form.toId);
        if (!from || !to || !form.amount) throw new Error("Pick from, to, and amount");
        addTransaction({
          date: (form.date as string) || todayStr,
          description: form.description || `Transfer: ${from.name} → ${to.name}`,
          kind: "transfer",
          entries: [
            { objectId: from.id, amount: -Math.abs(Number(form.amount)) },
            { objectId: to.id, amount: Math.abs(Number(form.amount)) },
          ],
        });
        toast.success("Transfer recorded");
      } else if (kind === "account" || kind === "liability") {
        addObject({
          domainId: form.domainId || defaultDomain || "personal",
          name: form.name || "Untitled",
          institution: form.institution,
          kind: kind === "liability" ? (form.kind || "loan") : (form.kind || "account"),
          currency: (form.currency as CurrencyCode) || "USD",
        });
        toast.success(`${kind === "liability" ? "Liability" : "Account"} created`);
      } else if (kind === "business") {
        addDomain({ name: form.name || "New Business", kind: "business" });
        toast.success("Business created");
      } else if (kind === "allocation") {
        addAllocation({
          domainId: form.domainId || defaultDomain || "personal",
          name: form.name || "Untitled allocation",
          target: form.target ? Number(form.target) : undefined,
          targetCurrency: (form.currency as CurrencyCode) || "NGN",
        });
        toast.success("Allocation created");
      } else if (kind === "goal") {
        if (!form.target) throw new Error("Enter a target amount");
        const deadline = form.deadline
          ? new Date(form.deadline as string).toISOString()
          : new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString();
        addGoal({
          domainId: form.domainId || defaultDomain || "personal",
          name: form.name || "Untitled goal",
          target: Number(form.target),
          currency: (form.currency as CurrencyCode) || "NGN",
          deadline,
          priority: "med",
        });
        toast.success("Goal created");
      } else if (kind === "budget") {
        if (!form.target) throw new Error("Enter a monthly amount");
        const now = new Date();
        const month =
          form.month ??
          `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
        addBudget({
          domainId: form.domainId || defaultDomain || "personal",
          month,
          currency: (form.currency as CurrencyCode) || "NGN",
          lines: form.categoryId
            ? [{ categoryId: form.categoryId, amount: Number(form.target) }]
            : [],
        });
        toast.success("Budget created");
      }
      onClose();
      setForm({});
    } catch (e: any) {
      toast.error(e?.message ?? "Something went wrong");
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels[kind]}</DialogTitle>
          <DialogDescription>
            Recorded in the workspace ledger — balances derive automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {kind === "transaction" && (
            <>
              <Field label="Description">
                <Input value={form.description ?? ""} onChange={(e) => setF("description", e.target.value)} placeholder="Groceries" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date">
                  <Input type="date" value={form.date ?? todayStr} onChange={(e) => setF("date", e.target.value)} />
                </Field>
                <Field label="Account">
                  <Select value={form.objectId} onValueChange={(v) => setF("objectId", v)}>
                    <SelectTrigger><SelectValue placeholder="Pick account" /></SelectTrigger>
                    <SelectContent>
                      {state.objects.map((o) => (
                        <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Amount (signed)">
                  <Input type="number" step="0.01" value={form.amount ?? ""} onChange={(e) => setF("amount", e.target.value)} placeholder="-4200" />
                </Field>
                <Field label="Category (optional)">
                  <Select value={form.categoryId} onValueChange={(v) => setF("categoryId", v)}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {state.categories.filter((c) => c.parentId).map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </>
          )}

          {kind === "transfer" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="From">
                  <Select value={form.fromId} onValueChange={(v) => setF("fromId", v)}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {state.objects.map((o) => (<SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="To">
                  <Select value={form.toId} onValueChange={(v) => setF("toId", v)}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {state.objects.map((o) => (<SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Amount">
                  <Input type="number" step="0.01" value={form.amount ?? ""} onChange={(e) => setF("amount", e.target.value)} />
                </Field>
                <Field label="Date">
                  <Input type="date" value={form.date ?? todayStr} onChange={(e) => setF("date", e.target.value)} />
                </Field>
              </div>
              <Field label="Note (optional)">
                <Input value={form.description ?? ""} onChange={(e) => setF("description", e.target.value)} />
              </Field>
            </>
          )}

          {(kind === "account" || kind === "liability") && (
            <>
              <Field label="Name">
                <Input value={form.name ?? ""} onChange={(e) => setF("name", e.target.value)} placeholder="GTBank" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Institution">
                  <Input value={form.institution ?? ""} onChange={(e) => setF("institution", e.target.value)} />
                </Field>
                <Field label="Currency">
                  <Select value={form.currency ?? "USD"} onValueChange={(v) => setF("currency", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(["NGN","USD","GBP","EUR"] as const).map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field label="Domain">
                <Select value={form.domainId ?? defaultDomain ?? "personal"} onValueChange={(v) => setF("domainId", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {state.domains.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </>
          )}

          {kind === "business" && (
            <Field label="Business name">
              <Input value={form.name ?? ""} onChange={(e) => setF("name", e.target.value)} placeholder="e.g. Studio Aria" />
            </Field>
          )}

          {(kind === "allocation" || kind === "goal" || kind === "budget") && (
            <>
              <Field label="Name">
                <Input value={form.name ?? ""} onChange={(e) => setF("name", e.target.value)} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={kind === "budget" ? "Monthly amount" : "Target amount"}>
                  <Input
                    type="number"
                    value={form.target ?? ""}
                    onChange={(e) => setF("target", e.target.value)}
                  />
                </Field>
                <Field label="Currency">
                  <Select
                    value={form.currency ?? "NGN"}
                    onValueChange={(v) => setF("currency", v)}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(["NGN","USD","GBP","EUR"] as const).map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field label="Domain">
                <Select
                  value={form.domainId ?? defaultDomain ?? "personal"}
                  onValueChange={(v) => setF("domainId", v)}
                >
                  <SelectTrigger><SelectValue placeholder="Pick domain" /></SelectTrigger>
                  <SelectContent>
                    {state.domains.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {kind === "goal" && (
                <Field label="Deadline">
                  <Input
                    type="date"
                    value={form.deadline ?? ""}
                    onChange={(e) => setF("deadline", e.target.value)}
                  />
                </Field>
              )}
              {kind === "budget" && (
                <Field label="Month (YYYY-MM)">
                  <Input
                    type="month"
                    value={form.month ?? ""}
                    onChange={(e) => setF("month", e.target.value)}
                  />
                </Field>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground uppercase tracking-wider">{label}</Label>
      {children}
    </div>
  );
}
