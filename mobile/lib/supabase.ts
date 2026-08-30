import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

/**
 * Supabase client.
 *
 * The URL and anon key come from EXPO_PUBLIC_ environment variables, which
 * Expo inlines into the bundle at build time. That is correct for these two
 * values: the anon key is designed to be public and every table it can reach
 * is protected by row level security.
 *
 * The service role key must never appear here. It bypasses RLS entirely, and
 * anything shipped in a mobile bundle should be treated as published.
 */

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and ' +
      'EXPO_PUBLIC_SUPABASE_ANON_KEY in .env, then restart the dev server so ' +
      'Expo picks them up.',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // There is no URL to read a session back from in a native app, and leaving
    // this on makes sign-in hang on some platforms.
    detectSessionInUrl: false,
  },
});
