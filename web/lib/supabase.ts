import { createClient } from "@supabase/supabase-js";

/**
 * Supabase clients for the console.
 *
 * Both use the anon key. Row level security is the boundary: an administrator's
 * JWT is what widens what they can read, not a privileged key. The service role
 * key must never reach this bundle, because NEXT_PUBLIC_ variables are inlined
 * into client JavaScript and a shipped bundle is published.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. Copy web/.env.example to web/.env.local.",
  );
}

/**
 * Browser client. Persists the session so an administrator is not signed out
 * on every navigation.
 */
export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/**
 * Server client, for the public verification page.
 *
 * Deliberately stateless: it never reads or writes a session, because the page
 * it serves is for people with no account at all. It calls verify_rbin, which
 * is granted to anon and returns only what establishes authenticity.
 */
export function createServerClient() {
  return createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
