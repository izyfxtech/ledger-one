import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
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

// App-wide TanStack Form setup: typed field components so every dialog and
// settings form is `form.AppField` + `<field.Text />`, instead of a
// `useState<Record<string, any>>` bag plus a hand-written onChange per input.

export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();

function errorText(errors: unknown[]): string | null {
  const e = errors[0] as { message?: string } | string | undefined;
  if (!e) return null;
  return typeof e === "string" ? e : (e.message ?? "Invalid value");
}

function FieldShell({
  label,
  children,
  errors,
}: {
  label: string;
  children: React.ReactNode;
  errors: unknown[];
}) {
  const err = errorText(errors);
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground uppercase tracking-wider">{label}</Label>
      {children}
      {err && <div className="text-xs text-destructive">{err}</div>}
    </div>
  );
}

function Text({
  label,
  type = "text",
  placeholder,
  step,
}: {
  label: string;
  type?: "text" | "number" | "date" | "month" | "password";
  placeholder?: string;
  step?: string;
}) {
  const field = useFieldContext<string>();
  return (
    <FieldShell label={label} errors={field.state.meta.errors}>
      <Input
        type={type}
        step={step}
        placeholder={placeholder}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
      />
    </FieldShell>
  );
}

function Pick({
  label,
  options,
  placeholder,
}: {
  label: string;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  const field = useFieldContext<string>();
  return (
    <FieldShell label={label} errors={field.state.meta.errors}>
      <Select value={field.state.value || undefined} onValueChange={field.handleChange}>
        <SelectTrigger>
          <SelectValue placeholder={placeholder ?? "—"} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldShell>
  );
}

function SubmitButton({ children }: { children: React.ReactNode }) {
  const form = useFormContext();
  return (
    <form.Subscribe selector={(s) => s.isSubmitting}>
      {(busy) => (
        <Button type="submit" disabled={busy}>
          {children}
        </Button>
      )}
    </form.Subscribe>
  );
}

export const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { Text, Pick },
  formComponents: { SubmitButton },
});

export const CURRENCY_OPTIONS = (["NGN", "USD", "GBP", "EUR"] as const).map((c) => ({
  value: c,
  label: c,
}));
