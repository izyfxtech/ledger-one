import { Link, type ErrorComponentProps } from "@tanstack/react-router";

/** Router-level error and not-found screens. Replace the hand-written
 *  class ErrorBoundary and the NotFound in App.tsx. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  return (
    <div className="h-full flex items-center justify-center bg-background text-foreground px-4">
      <div className="max-w-md">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Ledger error
        </div>
        <h1 className="mt-1 text-2xl font-medium">Something went sideways.</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The app hit an unexpected error. Your data on disk is untouched.
        </p>
        <pre className="mt-4 max-h-40 overflow-auto rounded-md border border-border bg-card p-3 text-xs">
          {(error as Error).message}
        </pre>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="text-sm border border-border rounded-md px-3 py-1.5 hover:bg-accent"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-sm border border-border rounded-md px-3 py-1.5 hover:bg-accent"
          >
            Reload app
          </button>
        </div>
      </div>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="flex h-full items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-mono text-7xl font-medium text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-medium">Not in the ledger</h2>
        <p className="mt-2 text-sm text-muted-foreground">This page doesn't exist.</p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Back to workspace
          </Link>
        </div>
      </div>
    </div>
  );
}

export function RouteFallback() {
  return (
    <div className="mx-auto max-w-7xl px-8 py-8 space-y-4">
      <div className="h-8 w-48 rounded-md bg-muted animate-pulse" />
      <div className="h-4 w-96 rounded-md bg-muted animate-pulse" />
      <div className="h-64 w-full rounded-md bg-muted animate-pulse" />
    </div>
  );
}
