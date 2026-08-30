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

interface AuthState {
  /** Undefined while the stored session is still being loaded. */
  session: Session | null | undefined;
  /** The user's profile row, loaded after sign in. Null until loaded. */
  profile: Profile | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);

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
      return;
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    if (!error) {
      setProfile(data as Profile);
    }
  }, []);

  useEffect(() => {
    if (session?.user) {
      refreshProfile();
    } else {
      setProfile(null);
    }
  }, [session?.user?.id, refreshProfile, session?.user]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({ session, profile, refreshProfile, signOut }),
    [session, profile, refreshProfile, signOut],
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
