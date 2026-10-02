import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cloudConfig, cloudEnabled } from "./config";

let client: SupabaseClient | undefined;

/** The one Supabase client. Throws if cloud isn't configured, so callers must
 *  check `cloudEnabled` first. */
export function supabase(): SupabaseClient {
  if (!cloudEnabled)
    throw new Error("Cloud sync is not configured (missing VITE_SUPABASE_* settings).");
  client ??= createClient(cloudConfig.url!, cloudConfig.anonKey!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // PKCE puts the one-time code in the query string, not the URL hash —
      // which this app's hash router owns.
      flowType: "pkce",
      detectSessionInUrl: true,
    },
  });
  return client;
}
