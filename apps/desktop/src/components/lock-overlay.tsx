import { useForm } from "@tanstack/react-form";
import { useSelector } from "@tanstack/react-store";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { securityQuery } from "@/lib/app-queries";
import { verifyPin } from "@/lib/local-store";
import { lock, lockStore, pinAttempts } from "@/lib/lock";
import { isTauriRuntime } from "@/lib/db/backend";

// Full-screen PIN overlay. Phase, idle tracking and the auto-lock timer live
// in @/lib/lock (a Store + one-time listeners); this component only renders.
export function LockOverlay() {
  const phase = useSelector(lockStore, (s) => s.phase);
  const { data: cfg } = useSuspenseQuery(securityQuery);

  const form = useForm({
    defaultValues: { pin: "" },
    onSubmit: async ({ value, formApi }) => {
      const fail = (msg: string) =>
        formApi.setFieldMeta("pin", (m) => ({ ...m, errorMap: { ...m.errorMap, onSubmit: msg } }));
      const wait = pinAttempts.remainingMs();
      if (wait > 0) {
        fail(`Too many attempts. Try again in ${Math.ceil(wait / 1000)}s.`);
        return;
      }
      if (await verifyPin(value.pin)) {
        pinAttempts.recordSuccess();
        formApi.reset();
        lock.unlock();
      } else {
        pinAttempts.recordFailure();
        const next = pinAttempts.remainingMs();
        fail(
          next > 0 ? `Incorrect PIN. Try again in ${Math.ceil(next / 1000)}s.` : "Incorrect PIN",
        );
      }
    },
  });

  if (phase !== "locked" || !cfg.pinHash) return null;

  return (
    <div
      className={
        "fixed inset-x-0 bottom-0 z-[9999] " +
        (isTauriRuntime() ? "top-[34px]" : "top-0") +
        " bg-background flex items-center justify-center px-4"
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        className="w-full max-w-sm text-center space-y-5"
      >
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            Workspace locked
          </div>
          <h2 className="mt-2 text-xl font-semibold">Enter PIN to continue</h2>
          <p className="mt-1 text-sm text-muted-foreground">Your data stays on this device.</p>
        </div>
        <form.Field name="pin">
          {(field) => (
            <>
              <Input
                autoFocus
                type="password"
                inputMode="numeric"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="••••"
                className="text-center text-lg tracking-widest"
              />
              {field.state.meta.errors[0] && (
                <div className="text-sm text-destructive">{String(field.state.meta.errors[0])}</div>
              )}
            </>
          )}
        </form.Field>
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(busy) => (
            <Button type="submit" className="w-full" disabled={busy}>
              Unlock
            </Button>
          )}
        </form.Subscribe>
      </form>
    </div>
  );
}
