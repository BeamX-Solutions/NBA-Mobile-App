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

/**
 * Creating a branch is reserved to a super administrator: the insert policy on
 * branches admits nobody else. Routes gated on this are hidden rather than
 * left to fail on save.
 */
export function isSuperAdmin(profile: Profile | null): boolean {
  return profile?.role === "super_admin";
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
  const [loadedProfile, setLoadedProfile] = useState<Profile | null>(null);
  /*
    Which user the loaded profile belongs to, rather than a bare "have we
    checked" flag.

    The flag had to be cleared the moment the session changed, which meant an
    effect that set state synchronously on every sign in and sign out. Holding
    the id instead makes the same fact derivable: the profile has been checked
    when the id it was loaded for is the id currently signed in. Signing out,
    or switching account, invalidates it without anything having to run.
  */
  const [checkedFor, setCheckedFor] = useState<string | null>(null);

  const userId = session === undefined || session === null ? null : session.user.id;
  // Never serve the previous user's profile while the next one is loading.
  const profile = userId !== null && checkedFor === userId ? loadedProfile : null;
  const profileChecked = userId !== null && checkedFor === userId;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => sub.subscription.unsubscribe();
  }, []);

  const refresh = useCallback(async () => {
    const current = (await supabase.auth.getSession()).data.session?.user.id;
    if (!current) {
      setLoadedProfile(null);
      setCheckedFor(null);
      return;
    }
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, email, scn, branch_id, role")
      .eq("id", current)
      .single();
    setLoadedProfile((data as Profile) ?? null);
    setCheckedFor(current);
  }, []);

  useEffect(() => {
    // Nothing to do when the session is still loading, and nothing to clear
    // when it is gone: the profile is derived from the signed-in id above, so
    // signing out already reads as no profile.
    if (session === undefined || session === null) return;

    let alive = true;
    const id = session.user.id;

    supabase
      .from("profiles")
      .select("id, full_name, email, scn, branch_id, role")
      .eq("id", id)
      .single()
      .then(({ data }) => {
        if (!alive) return;
        setLoadedProfile((data as Profile) ?? null);
        setCheckedFor(id);
      });

    return () => {
      alive = false;
    };
  }, [session]);

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
