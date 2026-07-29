import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PageContainer, PageHeader, SectionTitle } from "@/components/page";
import { useLedger, type CurrencyCode } from "@/lib/ledger";
import { DEFAULT_SETTINGS } from "@/lib/ledger/store";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import {
  loadSyncConfig,
  saveSyncConfig,
  enableNewSyncAccount,
  linkExistingSyncAccount,
  disableSync,
  accountFingerprint,
  type SyncConfig,
} from "@/lib/sync/account";

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
    id: "advanced",
    label: "Advanced",
    hint: "Sync and other advanced options.",
    panels: ["Sync"] as const,
  },
] as const;
type GroupId = (typeof GROUPS)[number]["id"];
type Panel =
  | "General" | "Appearance" | "Currencies" | "Exchange Rates"
  | "Import" | "Export" | "Backup" | "Sync"
  | "Security" | "Data Management" | "Users & Permissions";

function renderPanel(p: Panel) {
  switch (p) {
    case "General": return <General />;
    case "Appearance": return <Appearance />;
    case "Currencies": return <Currencies />;
    case "Exchange Rates": return <ExchangeRates />;
    case "Import": return <ImportPanel />;
    case "Export": return <ExportPanel />;
    case "Backup": return <BackupPanel />;
    case "Sync": return <SyncPanel />;
    case "Security": return <SecurityPanel />;
    case "Data Management": return <DataManagement />;
    case "Users & Permissions": return <UsersPanel />;
  }
}

export default function SettingsPage() {
  const [group, setGroup] = useState<GroupId>("workspace");
  const current = GROUPS.find((g) => g.id === group)!;

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
            <button
              key={g.id}
              onClick={() => setGroup(g.id)}
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
            </button>
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
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
] as const;

function useSettings() {
  const { state, updateSettings } = useLedger();
  const s = { ...DEFAULT_SETTINGS, ...(state.settings ?? {}) };
  return { s, updateSettings };
}

/** Tracks whether the active user can perform admin-tier actions (settings,
 *  security, reset, import/restore — see requirePermission() in
 *  store.tsx), refreshing when the active user switches. The backend
 *  guard is what actually enforces this; this just lets admin-only
 *  controls show as disabled instead of bouncing off a toast. */
function useCanAdmin() {
  const [canAdmin, setCanAdmin] = useState(() => canPerform("admin"));
  useEffect(() => {
    const sync = () => setCanAdmin(canPerform("admin"));
    window.addEventListener("ledgerone:users-changed", sync);
    return () => window.removeEventListener("ledgerone:users-changed", sync);
  }, []);
  return canAdmin;
}

function General() {
  const { s, updateSettings } = useSettings();
  return (
    <div>
      <SectionTitle>General</SectionTitle>
      <EditField label="Workspace name">
        <Input value={s.workspaceName} onChange={(e) => updateSettings({ workspaceName: e.target.value })} />
      </EditField>
      <EditField label="Default currency" hint="Reporting currency for consolidated totals.">
        <Select value={s.defaultCurrency} onValueChange={(v) => updateSettings({ defaultCurrency: v as CurrencyCode })}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ALL_CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </EditField>
      <EditField label="Fiscal year start">
        <Select value={s.fiscalYearStart} onValueChange={(v) => updateSettings({ fiscalYearStart: v as typeof s.fiscalYearStart })}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MONTHS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
      </EditField>
      <EditField label="Timezone">
        <Input value={s.timezone} onChange={(e) => updateSettings({ timezone: e.target.value })} />
      </EditField>
      <AutostartToggle />
    </div>
  );
}

function AutostartToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null); // null = loading
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("@tauri-apps/plugin-autostart")
      .then(({ isEnabled }) => isEnabled())
      .then((v) => { if (!cancelled) setEnabled(v); })
      .catch(() => { if (!cancelled) setEnabled(false); }); // e.g. unsupported platform/session
    return () => { cancelled = true; };
  }, []);

  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      const { enable, disable } = await import("@tauri-apps/plugin-autostart");
      await (next ? enable() : disable());
      setEnabled(next);
    } catch (err) {
      console.error("[autostart] toggle failed:", err);
      toast.error("Couldn't change startup setting");
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditField label="Start automatically" hint="Launch LedgerOne when you log in.">
      <input
        type="checkbox"
        disabled={enabled === null || busy}
        checked={enabled ?? false}
        onChange={(e) => toggle(e.target.checked)}
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

        <Select value={s.theme} onValueChange={(v) => updateSettings({ theme: v as typeof s.theme })}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
            <SelectItem value="system">System</SelectItem>
          </SelectContent>
        </Select>
      </EditField>
      <EditField label="Density">
        <Select value={s.density} onValueChange={(v) => updateSettings({ density: v as typeof s.density })}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
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
  const { state, toggleCurrency } = useLedger();
  return (
    <div>
      <SectionTitle>Currencies</SectionTitle>
      <p className="text-sm text-muted-foreground mb-3">
        Enable the currencies you want available across accounts, budgets, and goals.
      </p>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Code</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="text-right px-4 py-2 font-medium">Enabled</th>
            </tr>
          </thead>
          <tbody>
            {ALL_CURRENCIES.map((c) => {
              const inUse = state.objects.some((o) => o.currency === c);
              const enabled = state.currencies.includes(c) || inUse;
              return (
                <tr key={c} className="border-t border-border">
                  <td className="px-4 py-2.5 num">{c}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{inUse ? "In use" : "Available"}</td>
                  <td className="px-4 py-2.5 text-right">
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={inUse}
                      onChange={(e) => toggleCurrency(c, e.target.checked)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExchangeRates() {
  const { state, upsertFxRate, deleteFxRate } = useLedger();
  const [base, setBase] = useState<CurrencyCode>("NGN");
  const [rate, setRate] = useState("");
  return (
    <div>
      <SectionTitle>Exchange rates</SectionTitle>
      <p className="text-sm text-muted-foreground mb-3">
        Rate is how many USD one unit of the base currency is worth (e.g. NGN → 0.000660). USD is always 1 and doesn't need a row here.
      </p>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Base</th>
              <th className="text-right px-4 py-2 font-medium">Rate (→ USD)</th>
              <th className="w-24"></th>
            </tr>
          </thead>
          <tbody>
            {state.fx.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                  No rates configured yet. Add one below.
                </td>
              </tr>
            )}
            {state.fx.map((f) => (
              <tr key={f.base} className="border-t border-border">
                <td className="px-4 py-2.5 num">{f.base}</td>
                <td className="px-4 py-2.5 text-right num">
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
                </td>
                <td className="px-2 py-2 text-right">
                  <Button size="sm" variant="ghost" onClick={() => deleteFxRate(f.base)}>Remove</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-end gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Base</div>
          <Select value={base} onValueChange={(v) => setBase(v as CurrencyCode)}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ALL_CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Rate → USD</div>
          <Input
            className="w-40"
            type="number"
            step="0.000001"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder="0.000660"
          />
        </div>
        <Button
          onClick={() => {
            const v = Number(rate);
            if (!(v > 0)) {
              toast.error("Rate must be a positive number");
              return;
            }
            upsertFxRate({ base, quote: "USD", rate: v });
            setRate("");
            toast.success(`FX rate saved for ${base}`);
          }}
        >
          Save rate
        </Button>
      </div>
    </div>
  );
}

function ExportPanel() {
  const { exportState, state } = useLedger();
  const preview = useMemo(() => exportState().slice(0, 400), [exportState, state]);
  const [saving, setSaving] = useState(false);

  const onExport = async () => {
    setSaving(true);
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: `ledgerone-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: "LedgerOne snapshot", extensions: ["json"] }],
      });
      if (!path) return; // user cancelled the dialog
      await invoke("write_export_file", { path, content: exportState() });
      toast.success("Snapshot saved");
    } catch (err) {
      console.error("[export] failed:", err);
      toast.error("Couldn't save the file");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionTitle>Export</SectionTitle>
      <p className="text-sm text-muted-foreground">
        Save a complete JSON snapshot of the workspace (schema-versioned) to a location you choose.
      </p>
      <Button onClick={onExport} disabled={saving}>{saving ? "Saving…" : "Save JSON…"}</Button>
      <pre className="text-[11px] p-3 rounded-md bg-muted overflow-auto max-h-64">{preview}…</pre>
    </div>
  );
}

function ImportPanel() {
  const { importState } = useLedger();
  const [busy, setBusy] = useState(false);

  const onImport = async () => {
    setBusy(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "LedgerOne snapshot", extensions: ["json"] }],
      });
      if (!selected || Array.isArray(selected)) return; // cancelled
      const text = await invoke<string>("read_import_file", { path: selected });
      const parsed = JSON.parse(text);
      const candidate =
        parsed && typeof parsed === "object" && "state" in parsed
          ? (parsed as { state: unknown }).state
          : parsed;
      const res = await importState(candidate);
      if (res.ok) toast.success("Ledger imported");
      else toast.error(`Import failed: ${res.error.slice(0, 200)}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't read the file");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionTitle>Import</SectionTitle>
      <p className="text-sm text-muted-foreground">
        Replace the current workspace with a JSON snapshot. Validated against the schema — invalid files are rejected.
      </p>
      <Button onClick={onImport} disabled={busy}>{busy ? "Reading…" : "Choose JSON file…"}</Button>
    </div>
  );
}

function DataManagement() {
  const { reset } = useLedger();
  const canAdmin = useCanAdmin();
  return (
    <div className="space-y-4">
      <SectionTitle>Data management</SectionTitle>
      <div className="border border-border rounded-lg p-5">
        <div className="font-medium">Rerun onboarding</div>
        <div className="text-sm text-muted-foreground mt-1">
          Walks you through workspace basics, domains, accounts, categories, and PIN lock again. Your current data is only replaced if you finish the wizard.
        </div>
        <Button
          variant="outline"
          className="mt-3"
          onClick={async () => {
            await resetOnboarding();
            toast.success("Onboarding will start now");
          }}
        >
          Start onboarding
        </Button>
      </div>
      <div className="border border-border rounded-lg p-5">
        <div className="font-medium">Database file</div>
        <div className="text-sm text-muted-foreground mt-1">
          Your workspace lives in a single SQLite file on this device — nothing is sent anywhere else.
        </div>
        <Button
          variant="outline"
          className="mt-3"
          onClick={async () => {
            try {
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
      <div className="border border-border rounded-lg p-5">
        <div className="font-medium">Reset workspace</div>
        <div className="text-sm text-muted-foreground mt-1">
          Clears every account, transaction, budget, goal, allocation, and setting. This cannot be undone.
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

function BackupPanel() {
  const { state, replaceState } = useLedger();
  const [rows, setRows] = useState<BackupRecord[]>(() => listBackups());
  const [name, setName] = useState("");

  const refresh = () => setRows(listBackups());

  const onCreate = () => {
    const rec = createBackup(name, state);
    setName("");
    refresh();
    toast.success(`Snapshot saved (${formatBytes(rec.size)})`);
  };

  const onRestore = async (id: string) => {
    if (!confirm("Restore this snapshot? Current workspace data will be replaced.")) return;
    const next = restoreBackup(id);
    if (!next) return toast.error("Snapshot not found");
    await replaceState(next);
    toast.success("Snapshot restored");
  };

  const onDelete = (id: string) => {
    if (!confirm("Delete this snapshot?")) return;
    deleteBackup(id);
    refresh();
    toast.success("Snapshot deleted");
  };

  const onDownload = (rec: BackupRecord) => {
    const blob = new Blob(
      [JSON.stringify({ version: rec.version, state: rec.state }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${rec.name.replace(/[^a-z0-9-_]+/gi, "_") || "snapshot"}-${rec.createdAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <SectionTitle>Backup</SectionTitle>
      <p className="text-sm text-muted-foreground">
        Manual local snapshots of the workspace. Stored inside the app on this device — nothing leaves your machine.
      </p>

      <div className="flex items-end gap-3">
        <div className="flex-1">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Snapshot name (optional)</div>
          <Input
            placeholder={`Snapshot ${new Date().toLocaleDateString()}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Button onClick={onCreate}>Create snapshot</Button>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <th className="text-left px-4 py-2 font-medium">Created</th>
              <th className="text-right px-4 py-2 font-medium">Size</th>
              <th className="w-56"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  No snapshots yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-4 py-2.5">{r.name}</td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {new Date(r.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-2.5 text-right num">{formatBytes(r.size)}</td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => onDownload(r)}>Download</Button>
                  <Button size="sm" variant="ghost" onClick={() => onRestore(r.id)}>Restore</Button>
                  <Button size="sm" variant="ghost" onClick={() => onDelete(r.id)}>Delete</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Security (PIN lock)
// ---------------------------------------------------------------------------

function SecurityPanel() {
  const canAdmin = useCanAdmin();
  const [cfg, setCfg] = useState<SecurityConfig>(DEFAULT_SECURITY_VIEW);
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");
  const [currentPin, setCurrentPin] = useState("");

  useEffect(() => {
    let cancelled = false;
    const refresh = () => loadSecurity().then((c) => { if (!cancelled) setCfg(c); });
    refresh();
    window.addEventListener("ledgerone:security-changed", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("ledgerone:security-changed", refresh);
    };
  }, []);

  const hasPin = !!cfg.pinHash;

  const onSetPin = async () => {
    if (hasPin) {
      const ok = await verifyPin(currentPin);
      if (!ok) return toast.error("Current PIN is incorrect");
    }
    if (!/^\d{4,8}$/.test(pin1)) return toast.error("PIN must be 4–8 digits");
    if (pin1 !== pin2) return toast.error("PINs do not match");
    await setPin(pin1, { lockOnStart: cfg.lockOnStart, autoLockMinutes: cfg.autoLockMinutes });
    setPin1(""); setPin2(""); setCurrentPin("");
    toast.success(hasPin ? "PIN updated" : "PIN set");
  };

  const onRemovePin = async () => {
    if (!hasPin) return;
    const ok = await verifyPin(currentPin);
    if (!ok) return toast.error("Current PIN is incorrect");
    if (!confirm("Remove PIN protection?")) return;
    await clearPin();
    setCurrentPin("");
    toast.success("PIN removed");
  };

  return (
    <div className="space-y-5">
      <SectionTitle>Security</SectionTitle>
      <p className="text-sm text-muted-foreground">
        Protect this workspace with a local PIN. The PIN is hashed with a per-device salt (SHA-256) and stored on-device only.
      </p>

      <div className="border border-border rounded-lg p-5 space-y-3">
        <div className="font-medium">{hasPin ? "Change or remove PIN" : "Set a PIN"}</div>
        {hasPin && (
          <EditField label="Current PIN">
            <Input type="password" inputMode="numeric" value={currentPin} onChange={(e) => setCurrentPin(e.target.value)} className="w-40" />
          </EditField>
        )}
        <EditField label={hasPin ? "New PIN" : "PIN (4–8 digits)"}>
          <Input type="password" inputMode="numeric" value={pin1} onChange={(e) => setPin1(e.target.value)} className="w-40" />
        </EditField>
        <EditField label="Confirm PIN">
          <Input type="password" inputMode="numeric" value={pin2} onChange={(e) => setPin2(e.target.value)} className="w-40" />
        </EditField>
        <div className="flex gap-2">
          <Button onClick={onSetPin} disabled={!canAdmin}>{hasPin ? "Update PIN" : "Set PIN"}</Button>
          {hasPin && <Button variant="ghost" onClick={onRemovePin} disabled={!canAdmin}>Remove PIN</Button>}
        </div>
      </div>

      <div className="border border-border rounded-lg p-5 space-y-3">
        <div className="font-medium">Lock behavior</div>
        <EditField label="Lock on app start" hint="Require the PIN when the workspace first loads.">
          <input
            type="checkbox"
            disabled={!hasPin || !canAdmin}
            checked={cfg.lockOnStart}
            onChange={(e) => {
              const next = { ...cfg, lockOnStart: e.target.checked, updatedAt: new Date().toISOString() };
              setCfg(next);
              saveSecurity(next);
            }}
          />
        </EditField>
        <EditField label="Auto-lock after (minutes)" hint="0 disables auto-lock. Timer resets on activity.">
          <Input
            type="number"
            min={0}
            max={240}
            disabled={!hasPin || !canAdmin}
            className="w-32"
            value={cfg.autoLockMinutes}
            onChange={(e) => {
              const next = { ...cfg, autoLockMinutes: Math.max(0, Number(e.target.value) || 0), updatedAt: new Date().toISOString() };
              setCfg(next);
              saveSecurity(next);
            }}
          />
        </EditField>
        {!hasPin && (
          <div className="text-xs text-muted-foreground">Set a PIN above to enable lock behavior.</div>
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

function UsersPanel() {
  const canAdmin = useCanAdmin();
  const [users, setUsers] = useState<LocalUser[]>(() => loadUsers());
  const [activeId, setActive] = useState<string | null>(() => getActiveUserId() ?? loadUsers()[0]?.id ?? null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("editor");

  // Set when a switch requires the device PIN (stepping up to a
  // more-privileged user — see activateUser() in local-store.ts). Holding
  // the target id open a confirm dialog; clearing it closes the dialog
  // without switching.
  const [pendingActivateId, setPendingActivateId] = useState<string | null>(null);
  const [activatePin, setActivatePin] = useState("");
  const [activateError, setActivateError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    const handler = () => {
      setUsers(loadUsers());
      setActive(getActiveUserId());
    };
    window.addEventListener("ledgerone:users-changed", handler);
    return () => window.removeEventListener("ledgerone:users-changed", handler);
  }, []);

  const onAdd = () => {
    const trimmed = name.trim();
    if (!trimmed) return toast.error("Name is required");
    const next: LocalUser[] = [
      ...users,
      {
        id: `user_${Math.random().toString(36).slice(2, 9)}`,
        name: trimmed,
        email: email.trim() || undefined,
        role,
        createdAt: new Date().toISOString(),
      },
    ];
    saveUsers(next);
    setUsers(next);
    setName(""); setEmail(""); setRole("editor");
    toast.success("User added");
  };

  const onRoleChange = (id: string, newRole: UserRole) => {
    const next = users.map((u) => (u.id === id ? { ...u, role: newRole } : u));
    saveUsers(next);
    setUsers(next);
  };

  const onDelete = async (id: string) => {
    const target = users.find((u) => u.id === id);
    if (!target) return;
    if (users.length === 1) return toast.error("At least one user is required");
    if (target.role === "admin" && users.filter((u) => u.role === "admin").length === 1) {
      return toast.error("At least one admin is required");
    }
    if (!confirm(`Remove ${target.name}?`)) return;
    const next = users.filter((u) => u.id !== id);
    saveUsers(next);
    setUsers(next);
    if (activeId === id) {
      const nextActiveId = next[0]?.id;
      // The Remove button itself is admin-gated (disabled below unless
      // canAdmin), so whoever is active right now is already an admin —
      // reassigning to any remaining user is a step sideways or down,
      // never up, so this never actually prompts for a PIN. Handled
      // defensively anyway in case that invariant ever changes.
      if (nextActiveId) {
        const res = await activateUser(nextActiveId);
        if (res.ok) setActive(nextActiveId);
        else toast.error("Removed, but couldn't switch the active user automatically — set one manually.");
      } else {
        setActive(null);
      }
    }
    toast.success("User removed");
  };

  const onActivate = async (id: string) => {
    if (id === activeId) return;
    const res = await activateUser(id);
    if (res.ok) {
      setActive(id);
      toast.success("Active user updated");
      return;
    }
    // Stepping up to a more-privileged user with a PIN configured —
    // open the confirm dialog instead of silently failing.
    setPendingActivateId(id);
    setActivatePin("");
    setActivateError(null);
  };

  const pendingUser = users.find((u) => u.id === pendingActivateId) ?? null;

  const confirmActivate = async () => {
    if (!pendingActivateId) return;
    setActivating(true);
    const res = await activateUser(pendingActivateId, { pin: activatePin });
    setActivating(false);
    if (res.ok) {
      setActive(pendingActivateId);
      toast.success("Active user updated");
      setPendingActivateId(null);
      setActivatePin("");
      setActivateError(null);
    } else {
      setActivateError("Incorrect PIN");
      setActivatePin("");
    }
  };

  return (
    <div className="space-y-5">
      <SectionTitle>Users & Permissions</SectionTitle>
      <p className="text-sm text-muted-foreground">
        Manage the people who share this device's workspace. Viewers can look but not change anything; only Admins can touch settings, security, or reset the workspace.
      </p>

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <th className="text-left px-4 py-2 font-medium">Email</th>
              <th className="text-left px-4 py-2 font-medium">Role</th>
              <th className="text-left px-4 py-2 font-medium">Active</th>
              <th className="w-24"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="px-4 py-2.5">{u.name}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{u.email ?? "—"}</td>
                <td className="px-4 py-2.5">
                  <Select value={u.role} onValueChange={(v) => onRoleChange(u.id, v as UserRole)} disabled={!canAdmin}>
                    <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-4 py-2.5">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="radio"
                      name="active-user"
                      checked={activeId === u.id}
                      onChange={() => onActivate(u.id)}
                    />
                    <span className="text-xs text-muted-foreground">{activeId === u.id ? "Active" : "Set active"}</span>
                  </label>
                </td>
                <td className="px-2 py-1.5 text-right">
                  <Button size="sm" variant="ghost" onClick={() => onDelete(u.id)} disabled={!canAdmin}>Remove</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border border-border rounded-lg p-5 space-y-3">
        <div className="font-medium">Add a user</div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_180px_auto] gap-3 items-end">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Name</div>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Email (optional)</div>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Role</div>
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={onAdd} disabled={!canAdmin}>Add user</Button>
        </div>
        <div className="text-xs text-muted-foreground">
          {ROLES.map((r) => `${r.label}: ${r.hint}`).join(" • ")}
        </div>
      </div>

      <Dialog
        open={pendingActivateId != null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingActivateId(null);
            setActivatePin("");
            setActivateError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm switch to {pendingUser?.name ?? "this user"}</DialogTitle>
            <DialogDescription>
              {pendingUser?.name ?? "This user"} has a more-privileged role than the one currently
              active. Enter the device PIN to switch — this stops anyone from becoming an Admin
              just by selecting the row.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            inputMode="numeric"
            autoFocus
            placeholder="PIN"
            value={activatePin}
            onChange={(e) => {
              setActivatePin(e.target.value);
              setActivateError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmActivate();
            }}
          />
          {activateError && <p className="text-xs text-destructive">{activateError}</p>}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setPendingActivateId(null);
                setActivatePin("");
                setActivateError(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={confirmActivate} disabled={activating || !activatePin}>
              {activating ? "Checking…" : "Switch user"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SyncPanel() {
  const { state, syncNow } = useLedger();
  const [cfg, setCfg] = useState<SyncConfig>(() => loadSyncConfig());
  const [serverUrl, setServerUrl] = useState(cfg.serverUrl || "http://localhost:8787");
  const [linkSecret, setLinkSecret] = useState("");
  const [busy, setBusy] = useState<"enable" | "link" | "sync" | null>(null);
  const [revealSecret, setRevealSecret] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);

  useEffect(() => {
    const handler = () => setCfg(loadSyncConfig());
    window.addEventListener("ledgerone:sync-config-changed", handler);
    return () => window.removeEventListener("ledgerone:sync-config-changed", handler);
  }, []);

  const runInitialSync = async () => {
    setBusy("sync");
    const result = await syncNow();
    setBusy(null);
    if (result.ok) toast.success("Synced");
    else toast.error(result.error);
  };

  const onEnable = async () => {
    if (!/^https?:\/\/.+/.test(serverUrl)) return toast.error("Enter a valid server URL, e.g. http://localhost:8787");
    setBusy("enable");
    await enableNewSyncAccount(serverUrl.trim());
    setCfg(loadSyncConfig());
    setRevealSecret(true);
    await runInitialSync();
    setBusy(null);
  };

  const onLink = async () => {
    if (!/^https?:\/\/.+/.test(serverUrl)) return toast.error("Enter a valid server URL, e.g. http://localhost:8787");
    if (!linkSecret.trim()) return toast.error("Paste the sync secret from your other device");
    setBusy("link");
    await linkExistingSyncAccount(serverUrl.trim(), linkSecret.trim());
    setCfg(loadSyncConfig());
    setLinkSecret("");
    await runInitialSync();
    setBusy(null);
  };

  const onSyncNow = async () => {
    setBusy("sync");
    const result = await syncNow();
    setBusy(null);
    if (result.ok) toast.success("Synced");
    else toast.error(result.error);
  };

  const onDisable = () => {
    disableSync();
    setCfg(loadSyncConfig());
    toast.success("Sync turned off on this device — your other devices and the server are unaffected.");
  };

  const onForget = () => {
    saveSyncConfig({ enabled: false, serverUrl: "", secret: null, accountId: null, lastVersion: 0, lastSyncedAt: null });
    setCfg(loadSyncConfig());
    setConfirmForget(false);
    toast.success("This device has forgotten its sync secret.");
  };

  if (!cfg.enabled || !cfg.secret) {
    return (
      <div className="space-y-6 max-w-lg">
        <div>
          <SectionTitle>Sync across devices</SectionTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Optional, off by default. LedgerOne stays fully local either way — turning this on
            encrypts your ledger on this device and relays it through a server you point it at
            (self-hosted; see <code className="text-xs">packages/sync-server</code>) so another
            device can pull it down. The server only ever sees ciphertext.
          </p>
        </div>

        <EditField label="Sync server URL">
          <Input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="http://localhost:8787" />
        </EditField>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <div className="border border-border rounded-lg p-4 space-y-2">
            <div className="font-medium text-sm">First device</div>
            <p className="text-xs text-muted-foreground">
              Generates a new sync secret. You'll need to copy it to any other device you want to
              link — there's no email, password, or recovery option, by design.
            </p>
            <Button size="sm" onClick={onEnable} disabled={busy != null}>
              {busy === "enable" ? "Setting up…" : "Enable sync"}
            </Button>
          </div>
          <div className="border border-border rounded-lg p-4 space-y-2">
            <div className="font-medium text-sm">Another device already syncs</div>
            <p className="text-xs text-muted-foreground">Paste the sync secret shown on that device.</p>
            <Input
              value={linkSecret}
              onChange={(e) => setLinkSecret(e.target.value)}
              placeholder="XXXXX-XXXXX-XXXXX-…"
              className="font-mono text-xs"
            />
            <Button size="sm" variant="secondary" onClick={onLink} disabled={busy != null}>
              {busy === "link" ? "Linking…" : "Link this device"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <SectionTitle>Sync across devices</SectionTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Enabled on this device, pointed at <span className="font-mono text-xs">{cfg.serverUrl}</span>.
          Account <span className="font-mono text-xs">{accountFingerprint(cfg.accountId)}</span> — compare
          this on another device after linking to confirm both are on the same synced ledger.
        </p>
      </div>

      <div className="border border-border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">
              {cfg.lastSyncedAt ? "Last synced" : "Never synced yet"}
            </div>
            {cfg.lastSyncedAt && (
              <div className="text-xs text-muted-foreground">{new Date(cfg.lastSyncedAt).toLocaleString()}</div>
            )}
          </div>
          <Button size="sm" onClick={onSyncNow} disabled={busy != null}>
            {busy === "sync" ? "Syncing…" : "Sync now"}
          </Button>
        </div>
      </div>

      <div className="border border-border rounded-lg p-4 space-y-2">
        <div className="text-sm font-medium">Sync secret</div>
        <p className="text-xs text-muted-foreground">
          Copy this to link another device. Anyone with this secret can read and write this
          synced ledger — treat it like a password, and keep it somewhere you won't lose it. There
          is no way to recover it if you do.
        </p>
        <div className="flex gap-2">
          <Input
            readOnly
            type={revealSecret ? "text" : "password"}
            value={cfg.secret}
            className="font-mono text-xs"
          />
          <Button size="sm" variant="ghost" onClick={() => setRevealSecret((v) => !v)}>
            {revealSecret ? "Hide" : "Show"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              navigator.clipboard.writeText(cfg.secret!);
              toast.success("Copied");
            }}
          >
            Copy
          </Button>
        </div>
      </div>

      <div className="border border-destructive/30 rounded-lg p-4 space-y-3">
        <div className="text-sm font-medium">Danger zone</div>
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            Turn sync off on this device. Other linked devices and the server copy are unaffected
            — you can turn it back on here later without re-entering the secret.
          </p>
          <Button size="sm" variant="secondary" onClick={onDisable}>Turn off</Button>
        </div>
        <div className="flex items-center justify-between gap-4 pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground">
            Forget this device's copy of the secret entirely. You'd need to paste it in again from
            another device to reconnect — nothing on the server or any other device is deleted.
          </p>
          <Button size="sm" variant="destructive" onClick={() => setConfirmForget(true)}>Forget</Button>
        </div>
      </div>

      <Dialog open={confirmForget} onOpenChange={setConfirmForget}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Forget the sync secret on this device?</DialogTitle>
            <DialogDescription>
              This device will lose access to the synced ledger until the secret is pasted in
              again from another device. This does not delete anything on the server or on any
              other linked device.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmForget(false)}>Cancel</Button>
            <Button variant="destructive" onClick={onForget}>Forget secret</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

