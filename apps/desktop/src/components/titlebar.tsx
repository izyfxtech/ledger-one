import { useEffect, useState } from "react";
import { Minus, Square, Copy, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

// The window is created with `decorations: false` (see tauri.conf.json) so
// we can draw our own titlebar that actually respects the app's light/dark
// theme instead of whatever the OS window manager happens to render. The
// outer bar is a drag region (`data-tauri-drag-region`); the three control
// buttons opt out of that individually so they stay clickable.

const appWindow = (() => {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
})();

export function Titlebar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!appWindow) return;
    let cancelled = false;
    appWindow.isMaximized().then((v) => { if (!cancelled) setMaximized(v); }).catch(() => {});
    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then((v) => { if (!cancelled) setMaximized(v); }).catch(() => {});
    });
    return () => {
      cancelled = true;
      unlisten.then((f) => f()).catch(() => {});
    };
  }, []);

  if (!appWindow) return null;

  return (
    <div
      data-tauri-drag-region
      className="h-[34px] shrink-0 flex items-center select-none bg-background border-b border-border"
    >
      <div data-tauri-drag-region className="flex-1 h-full flex items-center gap-2 pl-3 min-w-0">
        <img src="/app-icon.png" alt="" className="size-4 rounded-[4px]" draggable={false} />
        <span className="text-xs font-medium text-muted-foreground truncate">LedgerOne</span>
      </div>
      <div className="flex h-full">
        <TitlebarButton label="Minimize" onClick={() => appWindow.minimize()}>
          <Minus className="size-3.5" />
        </TitlebarButton>
        <TitlebarButton label={maximized ? "Restore" : "Maximize"} onClick={() => appWindow.toggleMaximize()}>
          {maximized ? <Copy className="size-3" /> : <Square className="size-3" />}
        </TitlebarButton>
        <TitlebarButton label="Close" onClick={() => appWindow.close()} danger>
          <X className="size-3.5" />
        </TitlebarButton>
      </div>
    </div>
  );
}

function TitlebarButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={
        "w-[46px] h-full grid place-items-center text-muted-foreground transition-colors " +
        (danger
          ? "hover:bg-destructive hover:text-destructive-foreground"
          : "hover:bg-accent hover:text-foreground")
      }
    >
      {children}
    </button>
  );
}
