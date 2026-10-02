import { getCurrentWindow } from "@tauri-apps/api/window";
import { queryOptions } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { ui } from "@/lib/ui-store";

/** Play the short exit transition instead of letting the window vanish.
 *  Installed once at boot; replaces App's useState/useRef/useEffect. */
export function installWindowClose() {
  let win: ReturnType<typeof getCurrentWindow>;
  try {
    win = getCurrentWindow();
  } catch {
    return; // not running inside Tauri (tests, plain browser)
  }
  win
    .onResized(() => void queryClient.invalidateQueries({ queryKey: maximizedQuery.queryKey }))
    .catch(() => {});
  let closing = false;
  win
    .onCloseRequested((event) => {
      if (closing) return;
      closing = true;
      event.preventDefault();
      ui.setWindowClosing(true);
      window.setTimeout(() => void win.destroy().catch(() => {}), 260);
    })
    .catch(() => {});
}

/** Maximized state as a query, invalidated by the window's resize event
 *  (installed once in installWindowClose) — replaces the Titlebar's
 *  useState + effect + cancelled flag. */
export const maximizedQuery = queryOptions({
  queryKey: ["window", "maximized"],
  queryFn: async () => {
    try {
      return await getCurrentWindow().isMaximized();
    } catch {
      return false;
    }
  },
});
