import type { ReactNode } from "react";

export function PageContainer({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-7xl px-8 py-10">{children}</div>;
}

/**
 * Hero — the loudest thing on the page. One display-scale number anchors
 * the scan; eyebrow and title read at normal weight above it.
 *
 * When `value` is omitted the hero degrades to a large editorial headline
 * (used on the Businesses index, detail views without a single dominant
 * number, etc.).
 */
export function Hero({
  eyebrow,
  title,
  value,
  valueTone = "default",
  valueHint,
  description,
  actions,
  meta,
}: {
  eyebrow?: string;
  title: ReactNode;
  value?: ReactNode;
  valueTone?: "default" | "pos" | "neg" | "muted";
  valueHint?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="pt-2 pb-10 mb-8 border-b border-border">
      <div className="flex items-start justify-between gap-8">
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground mb-3">
              {eyebrow}
            </div>
          )}
          <h1 className="display text-[2.25rem] md:text-[2.75rem] leading-[1.05] text-balance">
            {title}
          </h1>
          {description && (
            <p className="text-sm text-muted-foreground mt-3 max-w-xl">{description}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0 pt-1">{actions}</div>}
      </div>

      {value !== undefined && (
        <div className="mt-8 flex flex-wrap items-end gap-x-10 gap-y-4">
          <div>
            <div
              className={[
                "hero-num text-[4.5rem] md:text-[6rem] animate-ticker-in",
                valueTone === "pos" ? "text-pos" : valueTone === "neg" ? "text-neg" : valueTone === "muted" ? "text-muted-foreground line-through" : "",
              ].join(" ")}
            >
              {value}
            </div>
            {valueHint && (
              <div className="text-xs text-muted-foreground mt-2 tracking-wide">{valueHint}</div>
            )}
          </div>
          {meta && <div className="pb-2 flex flex-wrap gap-x-8 gap-y-3">{meta}</div>}
        </div>
      )}
    </header>
  );
}

/** Small paired label/value used alongside a Hero — quieter than Stat. */
export function HeroMeta({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "pos" | "neg";
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      <div
        className={[
          "num text-base",
          tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "",
        ].join(" ")}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * PageHeader — retained for pages that need a simple heading without a hero
 * number (Reports, Settings, empty states). Uses the same display face so
 * the whole app feels of a piece.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-6 border-b border-border pb-6 mb-8">
      <div>
        {eyebrow && (
          <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground mb-2">
            {eyebrow}
          </div>
        )}
        <h1 className="display text-3xl md:text-4xl text-balance">{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-2 max-w-xl">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "pos" | "neg";
}) {
  return (
    <div className="flex flex-col gap-1 py-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div
        className={[
          "num text-2xl font-medium",
          tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "",
        ].join(" ")}
      >
        {value}
      </div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground font-medium">
        {children}
      </h2>
      {action}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="border border-dashed border-border rounded-lg py-12 px-6 text-center">
      <div className="display text-lg">{title}</div>
      {description && <div className="text-sm text-muted-foreground mt-1">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
