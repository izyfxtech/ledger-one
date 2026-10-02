import { createStore } from "@tanstack/react-store";
import { useSelector } from "@tanstack/react-store";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { DataTable, type Col } from "@/components/data-table";
import { todayLocal } from "@/lib/dates";
import { ledgerQuery } from "@/lib/ledger";
import { LEDGER_SCHEMA_VERSION } from "@/lib/ledger/schema";
import { Link as RouterLink, useNavigate, useSearch } from "@tanstack/react-router";
import { useAppForm } from "@/components/form-fields";
import { securityQuery, usersQuery } from "@/lib/app-queries";
import { isTauriRuntime } from "@/lib/db/backend";
import { pickTextFile, saveTextFile } from "@/lib/files";
import { PageContainer, PageHeader, SectionTitle } from "@/components/page";
import {
  DEFAULT_SETTINGS,
  useLedgerActions,
  useLedgerState,
  type CurrencyCode,
} from "@/lib/ledger";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  listBackups,
  createBackup,
  deleteBackup,
  restoreBackup,
  type BackupRecord,
} from "@/lib/backups";
import {
  loadSecurity,
  saveSecurity,
  setPin,
  clearPin,
  verifyPin,
  loadUsers,
  saveUsers,
  getActiveUserId,
  activateUser,
  resetOnboarding,
  canPerform,
  type LocalUser,
  type UserRole,
  type SecurityConfig,
} from "@/lib/local-store";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { authQuery, signOutRemote } from "@/lib/cloud/auth";
import { eraseLocalData, syncNow, syncStore } from "@/lib/sync/runtime";
import { outbox } from "@/lib/sync/outbox-instance";

const DEFAULT_SECURITY_VIEW: SecurityConfig = {
  pinHash: null,
  salt: null,
  lockOnStart: false,
  autoLockMinutes: 0,
  updatedAt: new Date(0).toISOString(),
};

// IA: five top-level groups (was 11 flat items). Each group renders its
// sub-panels stacked, so nothing was removed — just grouped for scan-ability.
const GROUPS = [
  {
    id: "workspace",
    label: "Workspace",
    hint: "Name, currency, timezone, theme, density.",
    panels: ["General", "Appearance"] as const,
  },
  {
    id: "money",
    label: "Money",
    hint: "Enabled currencies and FX conversion rates.",
    panels: ["Currencies", "Exchange Rates"] as const,
  },
  {
    id: "data",
    label: "Data",
    hint: "Import, export, snapshots, and workspace reset.",
    panels: ["Import", "Export", "Backup", "Data Management"] as const,
  },
  {
    id: "security",
    label: "Security & Users",
    hint: "Local PIN lock and local users.",
    panels: ["Security", "Users & Permissions"] as const,
  },
  {
    id: "account",
    label: "Account & Sync",
    hint: "Signed-in account and cloud sync.",
    panels: ["Account"] as const,
  },
] as const;
type GroupId = (typeof GROUPS)[number]["id"];
type Panel =
  | "General"
  | "Appearance"
  | "Currencies"
  | "Exchange Rates"
  | "Import"
  | "Export"
  | "Backup"
  | "Account"
  | "Security"
  | "Data Management"
  | "Users & Permissions";

function renderPanel(p: Panel) {
  switch (p) {
    case "General":
      return <General />;
    case "Appearance":
      return <Appearance />;
    case "Currencies":
      return <Currencies />;
    case "Exchange Rates":
      return <ExchangeRates />;
    case "Import":
      return <ImportPanel />;
    case "Export":
      return <ExportPanel />;
    case "Backup":
      return <BackupPanel />;
    case "Account":
      return <AccountPanel />;
    case "Security":
      return <SecurityPanel />;
    case "Data Management":
      return <DataManagement />;
    case "Users & Permissions":
      return <UsersPanel />;
  }
}

export default function SettingsPage() {
  // Active group lives in the URL (?group=security): deep-linkable, survives
  // reload, and back/forward works — was a useState.
  const { group = "workspace" } = useSearch({ strict: false }) as { group?: GroupId };
  const current = GROUPS.find((g) => g.id === group) ?? GROUPS[0];

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Settings"
        title="Workspace settings"
        description="Configure how LedgerOne behaves for your workspace."
      />

      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-8">
        <nav className="flex flex-col gap-0.5 text-sm">
          {GROUPS.map((g) => (
            <RouterLink
              key={g.id}
              to="/settings"
              search={{ group: g.id }}
              className={[
                "text-left px-3 py-2 rounded-md transition-colors",
                group === g.id
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              ].join(" ")}
            >
              <div>{g.label}</div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground/70 mt-0.5">
                {g.panels.join(" · ")}
              </div>
            </RouterLink>
          ))}
        </nav>

        <div className="space-y-12">
          <p className="text-sm text-muted-foreground -mt-2">{current.hint}</p>
          {current.panels.map((p) => (
            <section key={p}>{renderPanel(p as Panel)}</section>
          ))}
        </div>
      </div>
    </PageContainer>
  );
}

const ALL_CURRENCIES: CurrencyCode[] = ["NGN", "USD", "GBP", "EUR"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function useSettings() {
  const state = useLedgerState();
  const { updateSettings } = useLedgerActions();
  const s = { ...DEFAULT_SETTINGS, ...(state.settings ?? {}) };
  return { s, updateSettings };
}

/** Tracks whether the active user can perform admin-tier actions (settings,
 *  security, reset, import/restore — see requirePermission() in
 *  store.tsx), refreshing when the active user switches. The backend
 *  guard is what actually enforces this; this just lets admin-only
 *  controls show as disabled instead of bouncing off a toast. */
function useCanAdmin() {
  useQuery(usersQuery); // re-render when the active user/role changes
  return canPerform("admin");
}

function General() {
  const { s, updateSettings } = useSettings();
  // One form, each field autosaves on a debounce. Previously every keystroke
  // in "Workspace name" / "Timezone" wrote to SQLite immediately.
  const form = useAppForm({
    defaultValues: {
      workspaceName: s.workspaceName,
      defaultCurrency: s.defaultCurrency as string,
      fiscalYearStart: s.fiscalYearStart as string,
      timezone: s.timezone,
    },
  });
  const autosave = <K extends "workspaceName" | "defaultCurrency" | "fiscalYearStart" | "timezone">(
    name: K,
  ) => ({
    onChangeListenerDebounceMs: 400,
    onChange: ({ value }: { value: string }) =>
      updateSettings({ [name]: value } as Partial<typeof s>),
  });
  return (
    <div>
      <SectionTitle>General</SectionTitle>
      <div className="space-y-4 max-w-md">
        <form.AppField name="workspaceName" listeners={autosave("workspaceName")}>
          {(f) => <f.Text label="Workspace name" />}
        </form.AppField>
        <form.AppField name="defaultCurrency" listeners={autosave("defaultCurrency")}>
          {(f) => (
            <f.Pick
              label="Default currency"
              options={ALL_CURRENCIES.map((c) => ({ value: c, label: c }))}
            />
          )}
        </form.AppField>
        <form.AppField name="fiscalYearStart" listeners={autosave("fiscalYearStart")}>
          {(f) => (
            <f.Pick
              label="Fiscal year start"
              options={MONTHS.map((m) => ({ value: m, label: m }))}
            />
          )}
        </form.AppField>
        <form.AppField name="timezone" listeners={autosave("timezone")}>
          {(f) => <f.Text label="Timezone" />}
        </form.AppField>
      </div>
      <AutostartToggle />
    </div>
  );
}

const autostartQuery = {
  queryKey: ["autostart"] as const,
  queryFn: async () => {
    try {
      const { isEnabled } = await import("@tauri-apps/plugin-autostart");
      return await isEnabled();
    } catch {
      return false; // e.g. unsupported platform/session
    }
  },
};

function AutostartToggle() {
  if (!isTauriRuntime()) return null; // there is no "start at login" for a web page
  return <AutostartToggleInner />;
}

function AutostartToggleInner() {
  const qc = useQueryClient();
  const { data: enabled } = useQuery(autostartQuery);
  const toggle = useMutation({
    mutationFn: async (next: boolean) => {
      const { enable, disable } = await import("@tauri-apps/plugin-autostart");
      await (next ? enable() : disable());
      return next;
    },
    onSuccess: (next) => qc.setQueryData(autostartQuery.queryKey, next),
    onError: (err) => {
      console.error("[autostart] toggle failed:", err);
      toast.error("Couldn't change startup setting");
    },
  });
  return (
    <EditField label="Start automatically" hint="Launch LedgerOne when you log in.">
      <input
        type="checkbox"
        disabled={enabled === undefined || toggle.isPending}
        checked={enabled ?? false}
        onChange={(e) => toggle.mutate(e.target.checked)}
      />
    </EditField>
  );
}

function Appearance() {
  const { s, updateSettings } = useSettings();
  return (
    <div>
      <SectionTitle>Appearance</SectionTitle>
      <EditField label="Theme" hint="Applies immediately across the workspace.">
        <Select
          value={s.theme}
          onValueChange={(v) => updateSettings({ theme: v as typeof s.theme })}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
            <SelectItem value="system">System</SelectItem>
          </SelectContent>
        </Select>
      </EditField>
      <EditField label="Density">
        <Select
          value={s.density}
          onValueChange={(v) => updateSettings({ density: v as typeof s.density })}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="comfortable">Comfortable</SelectItem>
            <SelectItem value="compact">Compact</SelectItem>
          </SelectContent>
        </Select>
      </EditField>
    </div>
  );
}

function Currencies() {
  const state = useLedgerState();
  const { toggleCurrency } = useLedgerActions();
  return (
    <div>
      <SectionTitle>Currencies</SectionTitle>
      <p className="text-sm text-muted-foreground mb-3">
        Enable the currencies you want available across accounts, budgets, and goals.
      </p>
      <DataTable
        data={ALL_CURRENCIES.map((c) => {
          const inUse = state.objects.some((o) => o.currency === c);
          return { code: c, inUse, enabled: state.currencies.includes(c) || inUse };
        })}
        getRowId={(r) => r.code}
        columns={[
          { id: "code", header: "Code", accessorFn: (r) => r.code, className: "num" },
          {
            id: "status",
            header: "Status",
            accessorFn: (r) => (r.inUse ? "In use" : "Available"),
            className: "text-muted-foreground",
          },
          {
            id: "enabled",
            header: "Enabled",
            enableSorting: false,
            className: "text-right",
            cell: ({ row: { original: r } }) => (
              <input
                type="checkbox"
                checked={r.enabled}
                disabled={r.inUse}
                onChange={(e) => toggleCurrency(r.code, e.target.checked)}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

function ExchangeRates() {
  const state = useLedgerState();
  const { upsertFxRate, deleteFxRate } = useLedgerActions();
  const form = useAppForm({
    defaultValues: { base: "NGN" as string, rate: "" },
    validators: {
      onSubmit: ({ value }) =>
        Number(value.rate) > 0 ? undefined : { fields: { rate: "Rate must be a positive number" } },
    },
    onSubmit: ({ value, formApi }) => {
      upsertFxRate({ base: value.base as CurrencyCode, quote: "USD", rate: Number(value.rate) });
      toast.success(`FX rate saved for ${value.base}`);
      formApi.setFieldValue("rate", "");
    },
  });

  const columns: Col<(typeof state.fx)[number]>[] = [
    { id: "base", header: "Base", accessorFn: (f) => f.base, className: "num" },
    {
      id: "rate",
      header: "Rate (→ USD)",
      accessorFn: (f) => f.rate,
      className: "text-right",
      cell: ({ row: { original: f } }) => (
        <Input
          type="number"
          step="0.000001"
          className="w-40 ml-auto text-right"
          defaultValue={f.rate}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (v > 0 && v !== f.rate) upsertFxRate({ base: f.base, quote: "USD", rate: v });
          }}
        />
      ),
      enableSorting: false,
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      className: "text-right w-24",
      cell: ({ row: { original: f } }) => (
        <Button size="sm" variant="ghost" onClick={() => deleteFxRate(f.base)}>
          Remove
        </Button>
      ),
    },
  ];

  return (
    <div>
      <SectionTitle>Exchange rates</SectionTitle>
      <p className="text-sm text-muted-foreground mb-3">
        Rate is how many USD one unit of the base currency is worth. USD is always 1 and doesn't
        need a row here.
      </p>
      <DataTable
        data={state.fx}
        columns={columns}
        getRowId={(f) => f.base}
        empty={
          <div className="border border-border rounded-lg px-4 py-6 text-center text-sm text-muted-foreground">
            No rates configured yet. Add one below.
          </div>
        }
      />
      <form
        className="mt-4 flex items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <div className="w-32">
          <form.AppField name="base">
            {(f) => (
              <f.Pick label="Base" options={ALL_CURRENCIES.map((c) => ({ value: c, label: c }))} />
            )}
          </form.AppField>
        </div>
        <div className="w-40">
          <form.AppField name="rate">
            {(f) => <f.Text label="Rate → USD" type="number" step="0.000001" placeholder="Rate" />}
          </form.AppField>
        </div>
        <form.AppForm>
          <form.SubmitButton>Save rate</form.SubmitButton>
        </form.AppForm>
      </form>
    </div>
  );
}

function ExportPanel() {
  const { exportState } = useLedgerActions();
  // `select` is memoized on the cache entry, so the preview only re-stringifies
  // when the ledger actually changes (was a useMemo on [exportState, state]).
  const { data: preview } = useSuspenseQuery({
    ...ledgerQuery,
    select: (st) =>
      JSON.stringify({ version: LEDGER_SCHEMA_VERSION, state: st }, null, 2).slice(0, 400),
  });

  const save = useMutation({
    mutationFn: () =>
      saveTextFile({
        defaultName: `ledgerone-${todayLocal()}.json`,
        content: exportState(),
        filter: { name: "LedgerOne snapshot", extensions: ["json"] },
        mime: "application/json",
      }),
    onSuccess: (saved) => saved && toast.success("Snapshot saved"),
    onError: (err) => {
      console.error("[export] failed:", err);
      toast.error("Couldn't save the file");
    },
  });

  return (
    <div className="space-y-4">
      <SectionTitle>Export</SectionTitle>
      <p className="text-sm text-muted-foreground">
        Save a complete JSON snapshot of the workspace (schema-versioned) to a location you choose.
      </p>
      <Button onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Save JSON…"}
      </Button>
      <pre className="text-[11px] p-3 rounded-md bg-muted overflow-auto max-h-64">{preview}…</pre>
    </div>
  );
}

function ImportPanel() {
  const { importState } = useLedgerActions();
  const run = useMutation({
    mutationFn: async () => {
      const text = await pickTextFile({ name: "LedgerOne snapshot", extensions: ["json"] });
      if (text == null) return null; // cancelled
      const parsed = JSON.parse(text);
      const candidate =
        parsed && typeof parsed === "object" && "state" in parsed
          ? (parsed as { state: unknown }).state
          : parsed;
      return importState(candidate);
    },
    onSuccess: (res) => {
      if (!res) return;
      if (res.ok) toast.success("Ledger imported");
      else toast.error(`Import failed: ${res.error.slice(0, 200)}`);
    },
    onError: (e: Error) => toast.error(e?.message ?? "Couldn't read the file"),
  });

  return (
    <div className="space-y-4">
      <SectionTitle>Import</SectionTitle>
      <p className="text-sm text-muted-foreground">
        Replace the current workspace with a JSON snapshot. Validated against the schema — invalid
        files are rejected.
      </p>
      <Button onClick={() => run.mutate()} disabled={run.isPending}>
        {run.isPending ? "Reading…" : "Choose JSON file…"}
      </Button>
    </div>
  );
}

function DataManagement() {
  const { reset } = useLedgerActions();
  const navigate = useNavigate();
  const canAdmin = useCanAdmin();
  return (
    <div className="space-y-4">
      <SectionTitle>Data management</SectionTitle>
      <div className="border border-border rounded-lg p-5">
        <div className="font-medium">Rerun onboarding</div>
        <div className="text-sm text-muted-foreground mt-1">
          Walks you through currency, categories and opening accounts again. Finishing the wizard
          REPLACES your current accounts, transactions, budgets, goals, allocations and categories
          (a backup is saved first). Skipping changes nothing. It does not set a PIN or rename
          workspaces; do those here in Settings.
        </div>
        <Button
          variant="outline"
          className="mt-3"
          onClick={async () => {
            await resetOnboarding();
            toast.success("Onboarding will start now");
            await navigate({ to: "/onboarding" });
          }}
        >
          Start onboarding
        </Button>
      </div>
      {isTauriRuntime() && (
        <div className="border border-border rounded-lg p-5">
          <div className="font-medium">Database file</div>
          <div className="text-sm text-muted-foreground mt-1">
            This device keeps a local copy of your workspace in a single SQLite file, which is what
            the app uses when you're offline.
          </div>
          <Button
            variant="outline"
            className="mt-3"
            onClick={async () => {
              try {
                const { invoke } = await import("@tauri-apps/api/core");
                const path = await invoke<string>("get_db_path");
                const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
                await revealItemInDir(path);
              } catch (err) {
                console.error("[reveal db] failed:", err);
                toast.error("Couldn't open the file manager");
              }
            }}
          >
            Show database file
          </Button>
        </div>
      )}
      <div className="border border-border rounded-lg p-5">
        <div className="font-medium">Reset workspace</div>
        <div className="text-sm text-muted-foreground mt-1">
          Deletes every account, transaction, budget, goal, allocation, PIN, and onboarding/tour
          state, leaving an empty workspace (nothing is re-created). Workspace settings such as name
          and currency are kept. This cannot be undone.
        </div>
        <Button
          variant="destructive"
          className="mt-3"
          disabled={!canAdmin}
          onClick={async () => {
            if (!confirm("Reset the workspace? This deletes all data.")) return;
            await reset();
            toast.success("Workspace reset");
          }}
        >
          Reset workspace
        </Button>
      </div>
    </div>
  );
}

function EditField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[200px_1fr] items-center gap-4 py-3 border-b border-border">
      <div>
        <div className="text-sm text-muted-foreground">{label}</div>
        {hint && <div className="text-xs text-muted-foreground/80 mt-0.5">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Placeholder({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <div className="border border-dashed border-border rounded-lg py-16 text-center text-sm text-muted-foreground">
        {hint}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

const backupsQuery = { queryKey: ["backups"] as const, queryFn: async () => listBackups() };

function BackupPanel() {
  const qc = useQueryClient();
  const state = useLedgerState();
  const { replaceState } = useLedgerActions();
  const { data: rows = [] } = useQuery(backupsQuery);
  const refresh = () => qc.invalidateQueries({ queryKey: backupsQuery.queryKey });

  const form = useAppForm({
    defaultValues: { name: "" },
    onSubmit: ({ value, formApi }) => {
      const rec = createBackup(value.name, state);
      formApi.reset();
      void refresh();
      toast.success(`Snapshot saved (${formatBytes(rec.size)})`);
    },
  });

  const restore = useMutation({
    mutationFn: async (id: string) => {
      if (!confirm("Restore this snapshot? Current workspace data will be replaced.")) return false;
      const next = restoreBackup(id);
      if (!next) throw new Error("Snapshot not found");
      await replaceState(next);
      return true;
    },
    onSuccess: (done) => done && toast.success("Snapshot restored"),
    onError: (e: Error) => toast.error(e.message),
  });

  const onDelete = (id: string) => {
    if (!confirm("Delete this snapshot?")) return;
    deleteBackup(id);
    void refresh();
    toast.success("Snapshot deleted");
  };

  const onDownload = (rec: BackupRecord) => {
    const blob = new Blob([JSON.stringify({ version: rec.version, state: rec.state }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${rec.name.replace(/[^a-z0-9-_]+/gi, "_") || "snapshot"}-${rec.createdAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns: Col<BackupRecord>[] = [
    { id: "name", header: "Name", accessorFn: (r) => r.name },
    {
      id: "created",
      header: "Created",
      accessorFn: (r) => r.createdAt,
      cell: ({ getValue }) => new Date(getValue<string>()).toLocaleString(),
      className: "text-muted-foreground",
    },
    {
      id: "size",
      header: "Size",
      accessorFn: (r) => r.size,
      cell: ({ getValue }) => formatBytes(getValue<number>()),
      className: "num text-right",
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      className: "text-right whitespace-nowrap w-56",
      cell: ({ row: { original: r } }) => (
        <>
          <Button size="sm" variant="ghost" onClick={() => onDownload(r)}>
            Download
          </Button>
          <Button size="sm" variant="ghost" onClick={() => restore.mutate(r.id)}>
            Restore
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onDelete(r.id)}>
            Delete
          </Button>
        </>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <SectionTitle>Backup</SectionTitle>
      <p className="text-sm text-muted-foreground">
        Manual local snapshots of the workspace. Stored inside the app on this device — nothing
        leaves your machine.
      </p>

      <form
        className="flex items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <div className="flex-1">
          <form.AppField name="name">
            {(f) => (
              <f.Text
                label="Snapshot name (optional)"
                placeholder={`Snapshot ${new Date().toLocaleDateString()}`}
              />
            )}
          </form.AppField>
        </div>
        <form.AppForm>
          <form.SubmitButton>Create snapshot</form.SubmitButton>
        </form.AppForm>
      </form>

      <DataTable
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        empty={
          <div className="border border-border rounded-lg px-4 py-8 text-center text-sm text-muted-foreground">
            No snapshots yet.
          </div>
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Security (PIN lock)
// ---------------------------------------------------------------------------

function SecurityPanel() {
  const canAdmin = useCanAdmin();
  // Security config is a query; saveSecurity/setPin/clearPin invalidate it,
  // so there's no fetch effect or event listener here any more.
  const { data: cfg } = useSuspenseQuery(securityQuery);
  const hasPin = !!cfg.pinHash;

  const form = useAppForm({
    defaultValues: { currentPin: "", pin1: "", pin2: "" },
    validators: {
      onSubmitAsync: async ({ value }) => {
        if (hasPin && !(await verifyPin(value.currentPin))) {
          return { fields: { currentPin: "Current PIN is incorrect" } };
        }
        if (!/^\d{4,8}$/.test(value.pin1)) return { fields: { pin1: "PIN must be 4–8 digits" } };
        if (value.pin1 !== value.pin2) return { fields: { pin2: "PINs do not match" } };
        return undefined;
      },
    },
    onSubmit: async ({ value, formApi }) => {
      await setPin(value.pin1, {
        lockOnStart: cfg.lockOnStart,
        autoLockMinutes: cfg.autoLockMinutes,
      });
      formApi.reset();
      toast.success(hasPin ? "PIN updated" : "PIN set");
    },
  });

  const removePin = useMutation({
    mutationFn: async () => {
      if (!(await verifyPin(form.state.values.currentPin)))
        throw new Error("Current PIN is incorrect");
      if (!confirm("Remove PIN protection?")) return false;
      await clearPin();
      form.reset();
      return true;
    },
    onSuccess: (done) => done && toast.success("PIN removed"),
    onError: (e: Error) => toast.error(e.message),
  });

  const saveBehavior = useMutation({
    mutationFn: (patch: Partial<SecurityConfig>) =>
      saveSecurity({ ...cfg, ...patch, updatedAt: new Date().toISOString() }),
  });

  return (
    <div className="space-y-5">
      <SectionTitle>Security</SectionTitle>
      <p className="text-sm text-muted-foreground">
        Protect this workspace with a local PIN. The PIN is hashed with a per-device salt (SHA-256)
        and stored on-device only.
      </p>

      <form
        className="border border-border rounded-lg p-5 space-y-3 max-w-xs"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <div className="font-medium">{hasPin ? "Change or remove PIN" : "Set a PIN"}</div>
        {hasPin && (
          <form.AppField name="currentPin">
            {(f) => <f.Text label="Current PIN" type="password" />}
          </form.AppField>
        )}
        <form.AppField name="pin1">
          {(f) => <f.Text label={hasPin ? "New PIN" : "PIN (4–8 digits)"} type="password" />}
        </form.AppField>
        <form.AppField name="pin2">
          {(f) => <f.Text label="Confirm PIN" type="password" />}
        </form.AppField>
        <div className="flex gap-2">
          <form.Subscribe selector={(st) => st.isSubmitting}>
            {(busy) => (
              <Button type="submit" disabled={!canAdmin || busy}>
                {hasPin ? "Update PIN" : "Set PIN"}
              </Button>
            )}
          </form.Subscribe>
          {hasPin && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => removePin.mutate()}
              disabled={!canAdmin || removePin.isPending}
            >
              Remove PIN
            </Button>
          )}
        </div>
      </form>

      <div className="border border-border rounded-lg p-5 space-y-3">
        <div className="font-medium">Lock behavior</div>
        <EditField label="Lock on app start" hint="Require the PIN when the workspace first loads.">
          <input
            type="checkbox"
            disabled={!hasPin || !canAdmin}
            checked={cfg.lockOnStart}
            onChange={(e) => saveBehavior.mutate({ lockOnStart: e.target.checked })}
          />
        </EditField>
        <EditField
          label="Auto-lock after (minutes)"
          hint="0 disables auto-lock. Timer resets on activity."
        >
          <Input
            type="number"
            min={0}
            max={240}
            disabled={!hasPin || !canAdmin}
            className="w-32"
            defaultValue={cfg.autoLockMinutes}
            onBlur={(e) =>
              saveBehavior.mutate({ autoLockMinutes: Math.max(0, Number(e.target.value) || 0) })
            }
          />
        </EditField>
        {!hasPin && (
          <div className="text-xs text-muted-foreground">
            Set a PIN above to enable lock behavior.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Users & Permissions (local)
// ---------------------------------------------------------------------------

const ROLES: { value: UserRole; label: string; hint: string }[] = [
  { value: "admin", label: "Admin", hint: "Full access, including settings and reset." },
  { value: "editor", label: "Editor", hint: "Create and edit transactions and accounts." },
  { value: "viewer", label: "Viewer", hint: "Read-only access." },
];

/** Which user is waiting on a PIN to become active. Null = dialog closed. */
const pendingActivation = createStore<string | null>(null);

function UsersPanel() {
  const canAdmin = useCanAdmin();
  const { data } = useSuspenseQuery(usersQuery);
  const { users, activeId } = data;

  const form = useAppForm({
    defaultValues: { name: "", email: "", role: "editor" as string },
    validators: {
      onSubmit: ({ value }) =>
        value.name.trim() ? undefined : { fields: { name: "Name is required" } },
    },
    onSubmit: ({ value, formApi }) => {
      saveUsers([
        ...users,
        {
          id: `user_${crypto.randomUUID().slice(0, 8)}`,
          name: value.name.trim(),
          email: value.email.trim() || undefined,
          role: value.role as UserRole,
          createdAt: new Date().toISOString(),
        },
      ]);
      formApi.reset();
      toast.success("User added");
    },
  });

  const onRoleChange = (id: string, newRole: UserRole) =>
    saveUsers(users.map((u) => (u.id === id ? { ...u, role: newRole } : u)));

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const target = users.find((u) => u.id === id);
      if (!target) return false;
      if (users.length === 1) throw new Error("At least one user is required");
      if (target.role === "admin" && users.filter((u) => u.role === "admin").length === 1) {
        throw new Error("At least one admin is required");
      }
      if (!confirm(`Remove ${target.name}?`)) return false;
      const next = users.filter((u) => u.id !== id);
      saveUsers(next);
      if (activeId === id) {
        // The Remove button is admin-gated, so whoever is active is already an
        // admin; reassigning to a remaining user never needs a PIN. Handled
        // defensively anyway in case that invariant changes.
        const nextActiveId = next[0]?.id;
        if (nextActiveId) {
          const res = await activateUser(nextActiveId);
          if (!res.ok)
            toast.error(
              "Removed, but couldn't switch the active user automatically — set one manually.",
            );
        }
      }
      return true;
    },
    onSuccess: (done) => done && toast.success("User removed"),
    onError: (e: Error) => toast.error(e.message),
  });

  const activate = useMutation({
    mutationFn: (id: string) =>
      id === activeId ? Promise.resolve({ ok: true as const, same: true }) : activateUser(id),
    onSuccess: (res, id) => {
      if ("same" in res) return;
      if (res.ok) toast.success("Active user updated");
      // Stepping up to a more-privileged user with a PIN configured: ask for it.
      else pendingActivation.setState(() => id);
    },
  });

  const columns: Col<LocalUser>[] = [
    { id: "name", header: "Name", accessorFn: (u) => u.name },
    {
      id: "email",
      header: "Email",
      accessorFn: (u) => u.email ?? "—",
      className: "text-muted-foreground",
    },
    {
      id: "role",
      header: "Role",
      accessorFn: (u) => u.role,
      cell: ({ row: { original: u } }) => (
        <Select
          value={u.role}
          onValueChange={(v) => onRoleChange(u.id, v as UserRole)}
          disabled={!canAdmin}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLES.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
    {
      id: "active",
      header: "Active",
      enableSorting: false,
      cell: ({ row: { original: u } }) => (
        <label className="inline-flex items-center gap-2">
          <input
            type="radio"
            name="active-user"
            checked={activeId === u.id}
            onChange={() => activate.mutate(u.id)}
          />
          <span className="text-xs text-muted-foreground">
            {activeId === u.id ? "Active" : "Set active"}
          </span>
        </label>
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      className: "text-right w-24",
      cell: ({ row: { original: u } }) => (
        <Button size="sm" variant="ghost" onClick={() => remove.mutate(u.id)} disabled={!canAdmin}>
          Remove
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <SectionTitle>Users & Permissions</SectionTitle>
      <p className="text-sm text-muted-foreground">
        Manage the people who share this device's workspace. Viewers can look but not change
        anything; only Admins can touch settings, security, or reset the workspace.
      </p>

      <DataTable data={users} columns={columns} getRowId={(u) => u.id} />

      <form
        className="border border-border rounded-lg p-5 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <div className="font-medium">Add a user</div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_180px_auto] gap-3 items-end">
          <form.AppField name="name">
            {(f) => <f.Text label="Name" placeholder="Full name" />}
          </form.AppField>
          <form.AppField name="email">
            {(f) => <f.Text label="Email (optional)" placeholder="Email address" />}
          </form.AppField>
          <form.AppField name="role">
            {(f) => (
              <f.Pick
                label="Role"
                options={ROLES.map((r) => ({ value: r.value, label: r.label }))}
              />
            )}
          </form.AppField>
          <form.Subscribe selector={(st) => st.isSubmitting}>
            {(busy) => (
              <Button type="submit" disabled={!canAdmin || busy}>
                Add user
              </Button>
            )}
          </form.Subscribe>
        </div>
        <div className="text-xs text-muted-foreground">
          {ROLES.map((r) => `${r.label}: ${r.hint}`).join(" • ")}
        </div>
      </form>

      <ActivateDialog users={users} />
    </div>
  );
}

function ActivateDialog({ users }: { users: LocalUser[] }) {
  const pendingId = useSelector(pendingActivation, (s) => s);
  const close = () => pendingActivation.setState(() => null);
  const pendingUser = users.find((u) => u.id === pendingId) ?? null;

  const form = useAppForm({
    defaultValues: { pin: "" },
    onSubmit: async ({ value, formApi }) => {
      if (!pendingId) return;
      const res = await activateUser(pendingId, { pin: value.pin });
      if (res.ok) {
        toast.success("Active user updated");
        formApi.reset();
        close();
      } else {
        formApi.reset();
        formApi.setFieldMeta("pin", (m) => ({
          ...m,
          errorMap: { ...m.errorMap, onSubmit: "Incorrect PIN" },
        }));
      }
    },
  });

  return (
    <Dialog
      open={pendingId != null}
      onOpenChange={(open) => {
        if (!open) {
          form.reset();
          close();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm switch to {pendingUser?.name ?? "this user"}</DialogTitle>
          <DialogDescription>
            {pendingUser?.name ?? "This user"} has a more-privileged role than the one currently
            active. Enter the device PIN to switch — this stops anyone from becoming an Admin just
            by selecting the row.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.AppField name="pin">{(f) => <f.Text label="PIN" type="password" />}</form.AppField>
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                form.reset();
                close();
              }}
            >
              Cancel
            </Button>
            <form.AppForm>
              <form.SubmitButton>Switch user</form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AccountPanel() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: auth } = useSuspenseQuery(authQuery);
  const sync = useSelector(syncStore, (s) => s);

  const syncNowMutation = useMutation({
    mutationFn: () => syncNow(),
    onSuccess: (r) =>
      r.ok
        ? toast.success("Up to date")
        : r.offline
          ? toast.message("Offline — will sync when you're back online")
          : toast.error(r.error),
  });

  const signOut = useMutation({
    mutationFn: async () => {
      // Try to get everything into the cloud first.
      await syncNow();
      const pending = outbox.size;
      const warning = pending
        ? `\n\n${pending} change${pending === 1 ? " hasn't" : "s haven't"} reached the cloud yet and will be lost.`
        : "";
      if (
        !confirm(
          `Sign out? This removes this device's copy of your data (it stays safe in your account).${warning}`,
        )
      )
        return false;
      await eraseLocalData();
      await signOutRemote();
      await qc.fetchQuery({ ...authQuery, staleTime: 0 });
      return true;
    },
    onSuccess: (done) => done && navigate({ to: "/sign-in" }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (auth.mode === "local") {
    return (
      <div className="space-y-3 max-w-xl">
        <SectionTitle>Account & sync</SectionTitle>
        <p className="text-sm text-muted-foreground">
          Cloud sync is not set up in this build, so everything is stored only on this device. To
          sign in and sync between desktop and web, add your Supabase project's URL and anon key
          (see <code>docs/CLOUD.md</code>).
        </p>
      </div>
    );
  }
  if (auth.mode !== "cloud") return null;

  const phaseText: Record<string, string> = {
    off: "Not syncing",
    idle: "Up to date",
    syncing: "Syncing…",
    offline: "Offline — changes are saved on this device and will sync when you reconnect",
    error: sync.error ? `Sync problem: ${sync.error}` : "Sync problem",
  };

  return (
    <div className="space-y-5 max-w-xl">
      <SectionTitle>Account & sync</SectionTitle>
      <div className="border border-border rounded-lg p-5 space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Signed in as</div>
          <div className="font-medium">{auth.user.email || auth.user.id}</div>
        </div>
        <div className="text-sm">
          {auth.offline && sync.phase !== "idle" ? phaseText.offline : phaseText[sync.phase]}
        </div>
        <div className="text-xs text-muted-foreground">
          {sync.pending > 0
            ? `${sync.pending} change${sync.pending === 1 ? "" : "s"} waiting to upload. `
            : ""}
          {sync.lastSyncedAt
            ? `Last synced ${new Date(sync.lastSyncedAt).toLocaleString()}.`
            : "Not synced yet this session."}
        </div>
        <div className="flex gap-2 pt-1">
          <Button
            onClick={() => syncNowMutation.mutate()}
            disabled={syncNowMutation.isPending || sync.phase === "syncing"}
          >
            Sync now
          </Button>
          <Button variant="ghost" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
            Sign out
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Your data is saved on this device first, so the app keeps working without a connection, and
        syncs with your account whenever it can. If two devices change the same item, the most
        recent change wins.
      </p>
    </div>
  );
}
