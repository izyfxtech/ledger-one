// Edit / delete controls for the detail pages. These flows did not exist in
// the UI before: the store had `deleteTransaction` / `updateObject`, but
// nothing called them, and goals, allocations and budgets had no update or
// delete at all.
import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Pencil, Trash2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLedgerActions, useLedgerState, isLiability } from "@/lib/ledger";
import type { Allocation, FinancialObject, Goal, ObjectKind, Transaction } from "@/lib/ledger";
import { canPerform } from "@/lib/local-store";

const ASSET_KINDS: ObjectKind[] = ["account", "cash", "wallet", "investment"];
const LIABILITY_KINDS: ObjectKind[] = ["credit_card", "loan", "mortgage"];
const KIND_LABEL: Record<string, string> = {
  account: "Bank account",
  cash: "Cash",
  wallet: "Wallet",
  investment: "Investment",
  credit_card: "Credit card",
  loan: "Loan",
  mortgage: "Mortgage",
};
const NONE = "__none";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground uppercase tracking-wider">{label}</Label>
      {children}
    </div>
  );
}

function ActionBar({ onEdit, onDelete }: { onEdit?: () => void; onDelete: () => void }) {
  if (!canPerform("write")) return null;
  return (
    <div className="flex gap-2">
      {onEdit && (
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil className="size-3.5 mr-1.5" /> Edit
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={onDelete}
      >
        <Trash2 className="size-3.5 mr-1.5" /> Delete
      </Button>
    </div>
  );
}

function EditShell({
  title,
  description,
  onClose,
  onSave,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  onSave: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="grid gap-4 py-2 max-h-[65vh] overflow-y-auto pr-1">{children}</div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "" -> undefined (clear), otherwise a validated non-negative number. */
function numOrClear(v: string, what: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${what} must be a positive number`);
  return n;
}

// ---------------------------------------------------------------- accounts
export function AccountActions({
  object,
  basePath,
}: {
  object: FinancialObject;
  basePath: string;
}) {
  const state = useLedgerState();
  const { deleteObject } = useLedgerActions();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const liab = isLiability(object);

  const onDelete = () => {
    const touching = state.transactions.filter((t) =>
      t.entries.some((e) => e.objectId === object.id),
    );
    const whollyOwned = touching.filter((t) =>
      t.entries.every((e) => e.objectId === object.id),
    ).length;
    const transfers = touching.length - whollyOwned;
    const msg =
      `Delete "${object.name}"?\n\n` +
      `• ${whollyOwned} transaction${whollyOwned === 1 ? "" : "s"} that only involve it will be deleted.\n` +
      `• ${transfers} transfer${transfers === 1 ? "" : "s"} with other accounts will be kept but voided (excluded from balances) with a note.\n\n` +
      `This cannot be undone.`;
    if (!window.confirm(msg)) return;
    try {
      deleteObject(object.id);
      toast.success("Account deleted");
      void navigate({ to: (basePath + (liab ? "/liabilities" : "/accounts")) as never });
    } catch {
      /* permission toast already shown */
    }
  };

  return (
    <>
      <ActionBar onEdit={() => setEditing(true)} onDelete={onDelete} />
      {editing && <EditAccountDialog object={object} onClose={() => setEditing(false)} />}
    </>
  );
}

function EditAccountDialog({ object, onClose }: { object: FinancialObject; onClose: () => void }) {
  const { updateObject } = useLedgerActions();
  const liab = isLiability(object);
  const [f, setF] = useState({
    name: object.name,
    institution: object.institution ?? "",
    kind: object.kind,
    interestRate: object.interestRate != null ? String(object.interestRate) : "",
    minPayment: object.minPayment != null ? String(object.minPayment) : "",
    creditLimit: object.creditLimit != null ? String(object.creditLimit) : "",
    dueDay: object.dueDay != null ? String(object.dueDay) : "",
  });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = () => {
    try {
      if (!f.name.trim()) throw new Error("Name can't be empty");
      const dueDay = f.dueDay.trim() === "" ? undefined : Number(f.dueDay);
      if (dueDay !== undefined && (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31))
        throw new Error("Due day must be 1-31");
      // Blank means "clear it". updateObject sends an explicit null to the
      // database for these keys (see ObjectPatch in db.rs).
      updateObject(object.id, {
        name: f.name.trim(),
        institution: f.institution.trim() || undefined,
        kind: f.kind,
        ...(liab
          ? {
              interestRate: numOrClear(f.interestRate, "Interest rate"),
              minPayment: numOrClear(f.minPayment, "Minimum payment"),
              creditLimit:
                f.kind === "credit_card" ? numOrClear(f.creditLimit, "Credit limit") : undefined,
              dueDay,
            }
          : {}),
      });
      toast.success("Saved");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    }
  };
  return (
    <EditShell
      title={`Edit ${liab ? "liability" : "account"}`}
      description={`Currency (${object.currency}) can't be changed once an account exists, because its entries are recorded in that currency.`}
      onClose={onClose}
      onSave={save}
    >
      <Field label="Name">
        <Input value={f.name} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Institution">
          <Input value={f.institution} onChange={(e) => set("institution", e.target.value)} />
        </Field>
        <Field label="Type">
          <Select value={f.kind} onValueChange={(v) => set("kind", v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(liab ? LIABILITY_KINDS : ASSET_KINDS).map((k) => (
                <SelectItem key={k} value={k}>
                  {KIND_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      {liab && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Interest rate (% p.a.)">
              <Input
                type="number"
                step="0.01"
                min="0"
                value={f.interestRate}
                onChange={(e) => set("interestRate", e.target.value)}
              />
            </Field>
            <Field label="Minimum payment">
              <Input
                type="number"
                step="0.01"
                min="0"
                value={f.minPayment}
                onChange={(e) => set("minPayment", e.target.value)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {f.kind === "credit_card" && (
              <Field label="Credit limit">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={f.creditLimit}
                  onChange={(e) => set("creditLimit", e.target.value)}
                />
              </Field>
            )}
            <Field label="Payment due day (1-31)">
              <Input
                type="number"
                min="1"
                max="31"
                value={f.dueDay}
                onChange={(e) => set("dueDay", e.target.value)}
              />
            </Field>
          </div>
        </>
      )}
    </EditShell>
  );
}

// ------------------------------------------------------------------- goals
export function GoalActions({ goal, basePath }: { goal: Goal; basePath: string }) {
  const { deleteGoal } = useLedgerActions();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const onDelete = () => {
    if (
      !window.confirm(
        `Delete the goal "${goal.name}"?\n\nTransactions tagged to it stay; they just lose the tag. This cannot be undone.`,
      )
    )
      return;
    try {
      deleteGoal(goal.id);
      toast.success("Goal deleted");
      void navigate({ to: (basePath + "/goals") as never });
    } catch {
      /* permission toast already shown */
    }
  };
  return (
    <>
      <ActionBar onEdit={() => setEditing(true)} onDelete={onDelete} />
      {editing && <EditGoalDialog goal={goal} onClose={() => setEditing(false)} />}
    </>
  );
}

function EditGoalDialog({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const state = useLedgerState();
  const { updateGoal } = useLedgerActions();
  const [f, setF] = useState({
    name: goal.name,
    target: String(goal.target),
    deadline: goal.deadline.slice(0, 10), // older goals stored a full ISO timestamp
    priority: goal.priority ?? "med",
    linkedAllocationId: goal.linkedAllocationId ?? NONE,
    notes: goal.notes ?? "",
  });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const allocs = state.allocations.filter((a) => a.domainId === goal.domainId);
  const save = () => {
    try {
      const target = Number(f.target);
      if (!f.name.trim()) throw new Error("Name can't be empty");
      if (!Number.isFinite(target) || target <= 0) throw new Error("Target must be above zero");
      updateGoal(goal.id, {
        name: f.name.trim(),
        target,
        deadline: f.deadline || goal.deadline.slice(0, 10),
        priority: f.priority as Goal["priority"],
        linkedAllocationId: f.linkedAllocationId === NONE ? undefined : f.linkedAllocationId,
        notes: f.notes.trim() || undefined,
      });
      toast.success("Saved");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    }
  };
  return (
    <EditShell title="Edit goal" onClose={onClose} onSave={save}>
      <Field label="Name">
        <Input value={f.name} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Target (${goal.currency})`}>
          <Input
            type="number"
            min="0"
            value={f.target}
            onChange={(e) => set("target", e.target.value)}
          />
        </Field>
        <Field label="Deadline">
          <Input type="date" value={f.deadline} onChange={(e) => set("deadline", e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Priority">
          <Select value={f.priority} onValueChange={(v) => set("priority", v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="med">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Funded from allocation">
          <Select value={f.linkedAllocationId} onValueChange={(v) => set("linkedAllocationId", v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None</SelectItem>
              {allocs.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="Notes">
        <Input value={f.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
    </EditShell>
  );
}

// ------------------------------------------------------------- allocations
export function AllocationActions({
  allocation,
  basePath,
}: {
  allocation: Allocation;
  basePath: string;
}) {
  const { deleteAllocation } = useLedgerActions();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const onDelete = () => {
    if (
      !window.confirm(
        `Delete the allocation "${allocation.name}"?\n\nTransactions tagged to it stay; they just lose the tag, and goals funded from it are unlinked. This cannot be undone.`,
      )
    )
      return;
    try {
      deleteAllocation(allocation.id);
      toast.success("Allocation deleted");
      void navigate({ to: (basePath + "/allocations") as never });
    } catch {
      /* permission toast already shown */
    }
  };
  return (
    <>
      <ActionBar onEdit={() => setEditing(true)} onDelete={onDelete} />
      {editing && (
        <EditAllocationDialog allocation={allocation} onClose={() => setEditing(false)} />
      )}
    </>
  );
}

function EditAllocationDialog({
  allocation,
  onClose,
}: {
  allocation: Allocation;
  onClose: () => void;
}) {
  const { updateAllocation } = useLedgerActions();
  const [name, setName] = useState(allocation.name);
  const [target, setTarget] = useState(allocation.target != null ? String(allocation.target) : "");
  const save = () => {
    try {
      if (!name.trim()) throw new Error("Name can't be empty");
      updateAllocation(allocation.id, { name: name.trim(), target: numOrClear(target, "Target") });
      toast.success("Saved");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    }
  };
  return (
    <EditShell title="Edit allocation" onClose={onClose} onSave={save}>
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={`Target (${allocation.targetCurrency}, blank for none)`}>
        <Input type="number" min="0" value={target} onChange={(e) => setTarget(e.target.value)} />
      </Field>
    </EditShell>
  );
}

// ------------------------------------------------------------ transactions
export function TransactionActions({
  transaction,
  backTo,
}: {
  transaction: Transaction;
  backTo: string;
}) {
  const { deleteTransaction } = useLedgerActions();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const onDelete = () => {
    if (
      !window.confirm(
        `Delete "${transaction.description}"?\n\nThis removes it from every balance. If you only want it out of the totals but kept on record, set its status to Void instead. This cannot be undone.`,
      )
    )
      return;
    try {
      deleteTransaction(transaction.id);
      toast.success("Transaction deleted");
      void navigate({ to: backTo as never });
    } catch {
      /* permission toast already shown */
    }
  };
  return (
    <>
      <ActionBar onEdit={() => setEditing(true)} onDelete={onDelete} />
      {editing && (
        <EditTransactionDialog transaction={transaction} onClose={() => setEditing(false)} />
      )}
    </>
  );
}

function EditTransactionDialog({
  transaction,
  onClose,
}: {
  transaction: Transaction;
  onClose: () => void;
}) {
  const { updateTransaction } = useLedgerActions();
  const [f, setF] = useState({
    description: transaction.description,
    date: transaction.date.slice(0, 10),
    notes: transaction.notes ?? "",
  });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = () => {
    if (!f.description.trim()) return void toast.error("Description can't be empty");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return void toast.error("Pick a valid date");
    try {
      updateTransaction(transaction.id, {
        description: f.description.trim(),
        date: f.date,
        notes: f.notes.trim() || undefined,
      });
      toast.success("Saved");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    }
  };
  return (
    <EditShell
      title="Edit transaction"
      description="Amounts and accounts are fixed once recorded. To change those, delete it and record a new one."
      onClose={onClose}
      onSave={save}
    >
      <Field label="Description">
        <Input value={f.description} onChange={(e) => set("description", e.target.value)} />
      </Field>
      <Field label="Date">
        <Input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} />
      </Field>
      <Field label="Notes">
        <Input value={f.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
    </EditShell>
  );
}
