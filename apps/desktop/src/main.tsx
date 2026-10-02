import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import "./lib/boot-time";
import { queryClient, appKeys } from "./lib/query-client";
import { watchAuth } from "./lib/cloud/auth";
import { onExternalDatabaseChange } from "./lib/db/web-backend";
import { isTauriRuntime } from "./lib/db/backend";
import { ledgerKey } from "./lib/ledger";
import { installAppearance } from "./lib/ledger";
import { installWindowClose } from "./lib/window";
import { createAppRouter } from "./router";
import "./styles.css";

// Everything that used to be a component with an effect (window close
// handler, theme/density application, lock timers) is installed once here or
// in a route loader. Nothing below needs a Provider component except the
// TanStack ones.
const router = createAppRouter(queryClient);
installAppearance(queryClient);
installWindowClose();
watchAuth(queryClient);
// In a browser, another tab may change the same local database; refetch when it does.
if (!isTauriRuntime()) {
  onExternalDatabaseChange(() => {
    void queryClient.invalidateQueries({ queryKey: ledgerKey });
    for (const k of [appKeys.security, appKeys.onboarding, appKeys.tour, appKeys.users]) {
      void queryClient.invalidateQueries({ queryKey: k });
    }
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <HotkeysProvider>
        <RouterProvider router={router} />
      </HotkeysProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
