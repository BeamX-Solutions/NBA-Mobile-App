import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { Profile } from './database.types';
import { supabase } from './supabase';

/** Roles that administer a branch. They are refused a session in this app. */
export const ADMIN_ROLES: readonly string[] = ['branch_admin', 'super_admin'];

const ADMIN_REJECTION =
  'This is an administrator account. Administrators sign in on the web console. ' +
  'If you also practise, sign in here with your practitioner account.';

interface AuthState {
  /** Undefined while the stored session is still being loaded. */
  session: Session | null | undefined;
  /** The user's profile row, loaded after sign in. Null until loaded. */
  profile: Profile | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * Why the last session was closed without the user asking, for the login
   * screen to show. Set when an administrator signs in.
   */
  signInRejection: string | null;
  clearSignInRejection: () => void;
  /**
   * True when there is a session but its profile could not be read: offline,
   * a server error, or no profile row. The root layout shows a retry screen
   * instead of loading forever.
   */
  profileUnavailable: boolean;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [signInRejection, setSignInRejection] = useState<string | null>(null);
  const [profileUnavailable, setProfileUnavailable] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  const refreshProfile = useCallback(async () => {
    const userId = (await supabase.auth.getSession()).data.session?.user.id;
    if (!userId) {
      setProfile(null);
      setProfileUnavailable(false);
      return;
    }
    let result;
    try {
      result = await supabase.from('profiles').select('*').eq('id', userId).single();
    } catch {
      result = { data: null, error: true };
    }
    const { data, error } = result;
    // A profile already on screen is kept: a failed refresh from the
    // membership screen should not throw the member out of it.
    setProfileUnavailable(Boolean(error));
    if (error) {
      return;
    }
    // Client decision, 31 August 2026: administrator and practitioner are
    // separate accounts, and an administrator works only on the web console.
    // The credentials are valid, so Supabase issues a session; it is closed
    // here, before the profile reaches state, so the root layout keeps showing
    // its loading state until the session clears and never renders the app
    // shell for an administrator. This applies on every platform, Expo web
    // included. The database is still the real boundary: create_transaction()
    // and the transactions policies refuse an administrator regardless.
    if (ADMIN_ROLES.includes((data as Profile).role)) {
      setSignInRejection(ADMIN_REJECTION);
      await supabase.auth.signOut();
      return;
    }
    setProfile(data as Profile);
  }, []);

  useEffect(() => {
    if (session?.user) {
      refreshProfile();
    } else {
      setProfile(null);
      setProfileUnavailable(false);
    }
  }, [session?.user?.id, refreshProfile, session?.user]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const clearSignInRejection = useCallback(() => setSignInRejection(null), []);

  const value = useMemo(
    () => ({
      session,
      profile,
      refreshProfile,
      signOut,
      signInRejection,
      clearSignInRejection,
      profileUnavailable,
    }),
    [
      session,
      profile,
      refreshProfile,
      signOut,
      signInRejection,
      clearSignInRejection,
      profileUnavailable,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
