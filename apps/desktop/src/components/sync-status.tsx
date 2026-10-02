import { useSelector } from "@tanstack/react-store";
import { AlertTriangle, Cloud, CloudOff, RefreshCw } from "lucide-react";
import { Link } from "@/components/app-link";
import { syncStore } from "@/lib/sync/runtime";

/** Small cloud icon in the top bar: shows whether work is saved to the
 *  account, syncing, waiting for a connection, or stuck. Hidden when cloud
 *  sync isn't in use. */
export function SyncStatus() {
  const { phase, pending, error } = useSelector(syncStore, (s) => s);
  if (phase === "off") return null;

  const view = {
    idle: {
      Icon: Cloud,
      label: pending
        ? `${pending} change${pending === 1 ? "" : "s"} waiting to upload`
        : "All changes saved to your account",
    },
    syncing: { Icon: RefreshCw, label: "Syncing…" },
    offline: {
      Icon: CloudOff,
      label: "Offline — saved on this device, will sync when you reconnect",
    },
    error: { Icon: AlertTriangle, label: error ? `Sync problem: ${error}` : "Sync problem" },
  }[phase];

  return (
    <Link
      to="/settings?group=account"
      title={view.label}
      aria-label={view.label}
      className="relative inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <view.Icon className={phase === "syncing" ? "size-4 animate-spin" : "size-4"} />
      {pending > 0 && phase !== "syncing" && (
        <span className="absolute right-1 top-1 size-1.5 rounded-full bg-foreground" />
      )}
    </Link>
  );
}
