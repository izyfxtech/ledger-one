import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { supabase } from "./client";
import { cloudEnabled } from "./config";

export type CloudUser = { id: string; email: string };

export type AuthState =
  /** Cloud not configured: purely local, no sign-in. */
  | { mode: "local" }
  | { mode: "signed-out" }
  /** `offline` = the server couldn't be reached, but this device has a
   *  remembered account, so the locally cached data stays usable. */
  | { mode: "cloud"; user: CloudUser; offline: boolean };

const USER_KEY = "ledgerone.cloud.user";

function rememberUser(u: CloudUser | null) {
  try {
    if (u) window.localStorage.setItem(USER_KEY, JSON.stringify(u));
    else window.localStorage.removeItem(USER_KEY);
  } catch {
    /* storage unavailable: offline fallback just won't work */
  }
}

export function rememberedUser(): CloudUser | null {
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    const u = raw ? (JSON.parse(raw) as CloudUser) : null;
    return u && typeof u.id === "string" ? u : null;
  } catch {
    return null;
  }
}

async function loadAuth(): Promise<AuthState> {
  if (!cloudEnabled) return { mode: "local" };
  const { data, error } = await supabase().auth.getSession();
  const s = data.session;
  if (s?.user) {
    const user = { id: s.user.id, email: s.user.email ?? "" };
    rememberUser(user);
    return { mode: "cloud", user, offline: false };
  }
  // An expired token can't be refreshed without a network. That is not a
  // sign-out: keep the remembered account so the cached data stays usable.
  if (error && isAuthRetryableFetchError(error)) {
    const user = rememberedUser();
    if (user) return { mode: "cloud", user, offline: true };
  }
  return { mode: "signed-out" };
}

export const authQuery = queryOptions({ queryKey: ["auth"] as const, queryFn: loadAuth });

/** Refresh the cached auth state whenever Supabase reports a change. */
export function watchAuth(qc: QueryClient): () => void {
  if (!cloudEnabled) return () => {};
  const { data } = supabase().auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") rememberUser(null);
    if (event === "TOKEN_REFRESHED") return;
    // Deferred: Supabase must not be called from inside its own listener.
    setTimeout(() => void qc.fetchQuery({ ...authQuery, staleTime: 0 }).catch(() => {}), 0);
  });
  return () => data.subscription.unsubscribe();
}

export type AuthResult = { ok: true; needsConfirmation?: boolean } | { ok: false; error: string };

export async function signInWithPassword(email: string, password: string): Promise<AuthResult> {
  const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
  if (error) {
    return {
      ok: false,
      error: isAuthRetryableFetchError(error)
        ? "Can't reach the server. Sign-in needs a connection the first time."
        : error.message,
    };
  }
  return { ok: true };
}

export async function signUpWithPassword(email: string, password: string): Promise<AuthResult> {
  const { data, error } = await supabase().auth.signUp({ email: email.trim(), password });
  if (error) return { ok: false, error: error.message };
  // With email confirmation on, there is no session until the link is clicked.
  return { ok: true, needsConfirmation: !data.session };
}

export async function signOutRemote(): Promise<void> {
  rememberUser(null);
  // Local sign-out even if the network call fails.
  await supabase().auth.signOut({ scope: "local" });
}
