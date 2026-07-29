import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

type SidebarCtx = {
  /** desktop: full ↔ icons-only */
  collapsed: boolean;
  toggleCollapsed: () => void;
  /** mobile: drawer open */
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
};

const Ctx = createContext<SidebarCtx | null>(null);
const LS_KEY = "ledgerone.sidebar.collapsed";

export function SidebarShellProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(LS_KEY) === "1";
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();

  // Close the mobile drawer on route change so navigation feels snappy.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LS_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const toggleCollapsed = useCallback(() => setCollapsed((v) => !v), []);

  const value = useMemo(
    () => ({ collapsed, toggleCollapsed, mobileOpen, setMobileOpen }),
    [collapsed, toggleCollapsed, mobileOpen],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSidebarShell() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSidebarShell must be used within SidebarShellProvider");
  return v;
}
