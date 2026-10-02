// Category management for the Categories tab. Create, rename and delete/merge
// existed in the store/DB layer's schema but not in the UI: the New / Merge
// buttons were permanently disabled, and without a way to create categories
// the budget and transaction pickers had nothing to offer after onboarding.
// ("Archive" was dropped: the data model has no archived flag.)
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLedgerActions, useLedgerState, type Category } from "@/lib/ledger";
import { canPerform } from "@/lib/local-store";
import { SectionTitle } from "./page";

const NONE = "__none";

export function CategoriesPanel() {
  const state = useLedgerState();
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      <CategoryColumn
        title="Income"
        type="income"
        cats={state.categories.filter((c) => c.type === "income")}
      />
      <CategoryColumn
        title="Expense"
        type="expense"
        cats={state.categories.filter((c) => c.type === "expense")}
      />
    </div>
  );
}

function CategoryColumn({
  title,
  type,
  cats,
}: {
  title: string;
  type: Category["type"];
  cats: Category[];
}) {
  const { addCategory, updateCategory } = useLedgerActions();
  const canWrite = canPerform("write");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState(NONE);
  const [renaming, setRenaming] = useState<Category | null>(null);
  const [removing, setRemoving] = useState<Category | null>(null);
  const roots = cats.filter((c) => !c.parentId);

  const create = () => {
    const n = name.trim();
    if (!n) return void toast.error("Enter a name");
    if (
      cats.some(
        (c) => c.name.toLowerCase() === n.toLowerCase() && (c.parentId ?? NONE) === parentId,
      )
    )
      return void toast.error("That category already exists here");
    try {
      addCategory({ name: n, type, parentId: parentId === NONE ? undefined : parentId });
      setName("");
      setAdding(false);
      setParentId(NONE);
    } catch {
      /* permission toast already shown */
    }
  };

  const row = (c: Category, indent: boolean) => (
    <div
      key={c.id}
      className={[
        "group flex items-center justify-between py-1.5",
        indent ? "pl-8 pr-3 text-sm text-muted-foreground" : "px-4 font-medium text-sm",
      ].join(" ")}
    >
      <span>{c.name}</span>
      {canWrite && (
        <span className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 flex gap-1">
          <button
            type="button"
            aria-label={`Rename ${c.name}`}
            className="p-1 hover:text-foreground"
            onClick={() => setRenaming(c)}
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={`Delete or merge ${c.name}`}
            className="p-1 hover:text-destructive"
            onClick={() => setRemoving(c)}
          >
            <Trash2 className="size-3.5" />
          </button>
        </span>
      )}
    </div>
  );

  return (
    <div>
      <SectionTitle
        action={
          canWrite ? (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              onClick={() => setAdding((a) => !a)}
            >
              <Plus className="size-3" /> New
            </button>
          ) : undefined
        }
      >
        {title}
      </SectionTitle>

      {adding && (
        <div className="flex gap-2 mb-3">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`New ${type} category`}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
          />
          <Select value={parentId} onValueChange={setParentId}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Top level</SelectItem>
              {roots.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  Under {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={create}>Add</Button>
        </div>
      )}

      <div className="border border-border rounded-lg bg-card">
        {roots.length === 0 && (
          <div className="px-4 py-6 text-sm text-muted-foreground">No {type} categories yet.</div>
        )}
        {roots.map((r) => (
          <div key={r.id} className="border-b border-border last:border-b-0">
            {row(r, false)}
            {cats.filter((c) => c.parentId === r.id).map((k) => row(k, true))}
          </div>
        ))}
      </div>

      {renaming && (
        <RenameDialog
          category={renaming}
          onClose={() => setRenaming(null)}
          onSave={(n) => {
            try {
              updateCategory(renaming.id, { name: n });
            } catch {
              /* toast shown */
            }
            setRenaming(null);
          }}
        />
      )}
      {removing && (
        <RemoveDialog
          category={removing}
          siblings={cats.filter((c) => c.id !== removing.id)}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

function RenameDialog({
  category,
  onClose,
  onSave,
}: {
  category: Category;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(category.name);
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename category</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) onSave(name.trim());
          }}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => (name.trim() ? onSave(name.trim()) : toast.error("Enter a name"))}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveDialog({
  category,
  siblings,
  onClose,
}: {
  category: Category;
  siblings: Category[];
  onClose: () => void;
}) {
  const state = useLedgerState();
  const { deleteCategory } = useLedgerActions();
  const [target, setTarget] = useState(NONE);
  const used = state.transactions.reduce(
    (n, t) => n + t.entries.filter((e) => e.categoryId === category.id).length,
    0,
  );
  const lines = state.budgets.reduce(
    (n, b) => n + b.lines.filter((l) => l.categoryId === category.id).length,
    0,
  );
  const children = state.categories.filter((c) => c.parentId === category.id).length;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete or merge "{category.name}"</DialogTitle>
          <DialogDescription>
            Used by {used} transaction entr{used === 1 ? "y" : "ies"} and {lines} budget line
            {lines === 1 ? "" : "s"}
            {children
              ? `; its ${children} sub-categor${children === 1 ? "y" : "ies"} move to the top level`
              : ""}
            .
          </DialogDescription>
        </DialogHeader>
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>
              Don't reassign: entries become uncategorised, budget lines are removed
            </SelectItem>
            {siblings.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                Merge into {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              try {
                deleteCategory(category.id, target === NONE ? undefined : target);
                toast.success(target === NONE ? "Category deleted" : "Categories merged");
              } catch {
                /* permission toast already shown */
              }
              onClose();
            }}
          >
            {target === NONE ? "Delete" : "Merge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
