import React from "react";
import ReactDOM from "react-dom/client";
import "./lib/boot-time";
import App from "./App";
import "./styles.css";

// No more pre-render seed priming: LockGate and OnboardingGate (see
// @/components) already gate real content behind their own async
// "checking" phases until the ledger has actually hydrated, so there's no
// flash to avoid by blocking the first paint here. Seeding itself now
// happens entirely in Rust (see src-tauri/src/db.rs's ensure_seeded,
// called from store.tsx's hydrate effect).
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
