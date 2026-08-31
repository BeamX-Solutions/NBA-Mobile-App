"use client";

import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { supabase } from "@/lib/supabase";

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  scn: string | null;
  branch_id: string | null;
  role: "individual" | "branch_member" | "branch_admin" | "super_admin";
}

/** The roles this console exists for. Everyone else is turned away at sign in. */
export const ADMIN_ROLES: Profile["role"][] = ["branch_admin", "super_admin"];

export function isAdmin(profile: Profile | null): boolean {
  return profile !== null && ADMIN_ROLES.includes(profile.role);
}

interface AuthState {
  /** undefined while the stored session is still being read. */
  session: Session | null | undefined;
  profile: Profile | null;
  /** True once we know both the session and, if there is one, the profile. */
  ready: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileChecked, setProfileChecked] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => sub.subscription.unsubscribe();
  }, []);

  const refresh = useCallback(async () => {
    const userId = (await supabase.auth.getSession()).data.session?.user.id;
    if (!userId) {
      setProfile(null);
      setProfileChecked(true);
      return;
    }
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, email, scn, branch_id, role")
      .eq("id", userId)
      .single();
    setProfile((data as Profile) ?? null);
    setProfileChecked(true);
  }, []);

  useEffect(() => {
    if (session === undefined) return;
    if (session === null) {
      setProfile(null);
      setProfileChecked(true);
      return;
    }
    setProfileChecked(false);
    refresh();
  }, [session, refresh]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      ready: session !== undefined && (session === null || profileChecked),
      refresh,
      signOut,
    }),
    [session, profile, profileChecked, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
