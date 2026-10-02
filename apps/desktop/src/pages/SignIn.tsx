import { useNavigate, useSearch } from "@tanstack/react-router";
import { Link as RouterLink } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { createStore } from "@tanstack/react-store";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAppForm } from "@/components/form-fields";
import { authQuery, signInWithPassword, signUpWithPassword } from "@/lib/cloud/auth";
import { ledgerKey, ledgerQuery } from "@/lib/ledger";
import { setOnboardingComplete } from "@/lib/local-store";
import {
  OtherAccountDataError,
  eraseLocalData,
  ledgerHasContent,
  startCloudSession,
  syncNow,
} from "@/lib/sync/runtime";

/** Messages that need more than a field error (blocked sign-in, check-email). */
const notice = createStore({ blocked: null as string | null, checkEmail: false });

const schema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(8, "At least 8 characters"),
});

export default function SignInPage() {
  const { mode = "signin" } = useSearch({ strict: false }) as { mode?: "signin" | "signup" };
  const signingUp = mode === "signup";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const blocked = useSelector(notice, (s) => s.blocked);
  const checkEmail = useSelector(notice, (s) => s.checkEmail);

  const form = useAppForm({
    defaultValues: { email: "", password: "" },
    validators: { onSubmit: schema as never },
    onSubmit: async ({ value, formApi }) => {
      notice.setState(() => ({ blocked: null, checkEmail: false }));
      const fail = (msg: string) =>
        formApi.setFieldMeta("password", (m) => ({
          ...m,
          errorMap: { ...m.errorMap, onSubmit: msg },
        }));

      const res = signingUp
        ? await signUpWithPassword(value.email, value.password)
        : await signInWithPassword(value.email, value.password);
      if (!res.ok) return fail(res.error);
      if (res.needsConfirmation) {
        notice.setState((s) => ({ ...s, checkEmail: true }));
        return;
      }

      await qc.invalidateQueries({ queryKey: authQuery.queryKey });
      const auth = await qc.fetchQuery({ ...authQuery, staleTime: 0 });
      if (auth.mode !== "cloud")
        return fail("Signed in, but the session could not be read. Try again.");

      try {
        await startCloudSession(auth.user.id);
      } catch (e) {
        if (e instanceof OtherAccountDataError) {
          notice.setState((s) => ({ ...s, blocked: e.message }));
          return;
        }
        throw e;
      }

      // Pull this account's data before showing anything, so a new device
      // opens straight onto the existing workspace instead of first-run setup.
      const result = await syncNow();
      await qc.invalidateQueries({ queryKey: ledgerKey });
      const state = await qc.fetchQuery({ ...ledgerQuery, staleTime: 0 });
      if (ledgerHasContent(state)) await setOnboardingComplete();
      if (!result.ok && !result.offline)
        toast.error(`Signed in, but the first sync failed: ${result.error}`);
      await navigate({ to: "/" });
    },
  });

  return (
    <div className="h-full flex items-center justify-center bg-background px-4">
      <form
        className="w-full max-w-sm space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">LedgerOne</div>
          <h1 className="mt-1 text-2xl font-semibold">
            {signingUp ? "Create your account" : "Sign in"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your ledger is saved to your account and works offline on every device you sign in on.
          </p>
        </div>

        <form.AppField name="email">
          {(f) => <f.Text label="Email" placeholder="you@email.com" />}
        </form.AppField>
        <form.AppField name="password">
          {(f) => <f.Text label="Password" type="password" />}
        </form.AppField>

        {checkEmail && (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            Check your email to confirm your address, then come back and sign in.
          </div>
        )}
        {blocked && (
          <div className="rounded-md border border-neg/30 bg-neg/5 p-3 text-sm space-y-2">
            <div>{blocked}</div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                if (
                  !confirm("Erase this device's data? Changes that were never synced will be lost.")
                )
                  return;
                await eraseLocalData();
                notice.setState((s) => ({ ...s, blocked: null }));
                toast.success("This device's data was erased. Sign in again.");
              }}
            >
              Erase this device's data
            </Button>
          </div>
        )}

        <form.AppForm>
          <form.SubmitButton>{signingUp ? "Create account" : "Sign in"}</form.SubmitButton>
        </form.AppForm>

        <div className="text-sm text-muted-foreground">
          {signingUp ? "Already have an account? " : "New here? "}
          <RouterLink
            to="/sign-in"
            search={{ mode: signingUp ? "signin" : "signup" }}
            className="underline text-foreground"
          >
            {signingUp ? "Sign in" : "Create an account"}
          </RouterLink>
        </div>
      </form>
    </div>
  );
}
