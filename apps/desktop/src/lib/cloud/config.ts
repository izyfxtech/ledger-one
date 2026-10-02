/**
 * Cloud is optional. With no Supabase settings the app behaves exactly as it
 * did before accounts: everything stays on this device and there is no
 * sign-in. Set both variables (see .env.example) to turn cloud sync on.
 *
 * The anon key is meant to be public — row-level security in the database is
 * what protects the data, not the key.
 */
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

export const cloudConfig = { url, anonKey } as const;
export const cloudEnabled = Boolean(url && anonKey);
