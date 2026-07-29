import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Last-resort boundary so a rendering error in one page doesn't leave the
 * user staring at a blank Tauri window. We intentionally keep this tiny and
 * dependency-free; the ledger provider already recovers from a corrupt
 * snapshot on its own.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("[ledger] render error", error, info);
  }

  private reset = () => this.setState({ error: null });
  private hardReset = () => window.location.reload();

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="h-full flex items-center justify-center bg-background text-foreground px-4">
        <div className="max-w-md">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Ledger error</div>
          <h1 className="mt-1 text-2xl font-medium">Something went sideways.</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The app hit an unexpected error while rendering. Your data on disk is untouched.
          </p>
          <pre className="mt-4 max-h-40 overflow-auto rounded-md border border-border bg-card p-3 text-xs">
            {this.state.error.message}
          </pre>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={this.reset}
              className="press h-9 rounded-md bg-ink px-3 text-sm font-medium text-paper hover:opacity-90"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={this.hardReset}
              className="press h-9 rounded-md border border-border px-3 text-sm hover:bg-accent"
            >
              Reload app
            </button>
          </div>
        </div>
      </div>
    );
  }
}
