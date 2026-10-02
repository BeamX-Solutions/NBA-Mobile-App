import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AccountUnavailable } from '@/components/ui/AccountUnavailable';
import { AppHeader } from '@/components/ui/AppHeader';
import { MembershipPending } from '@/components/ui/MembershipPending';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { ADMIN_ROLES, AuthProvider, useAuth } from '@/lib/auth-context';
import { useAppFonts } from '@/lib/fonts';
import { OnboardingProvider, useOnboardingSeen } from '@/lib/onboarding';
import { palette } from '@/theme/tokens';

export { ErrorBoundary } from 'expo-router';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <AuthProvider>
      <OnboardingProvider>
        <StatusBar style="dark" />
        <OfflineBanner />
        <RootNavigator />
      </OnboardingProvider>
    </AuthProvider>
  );
}

/**
 * Options for any screen carrying the shared header.
 *
 * `headerShown: true` is essential and easy to miss: the Stack sets
 * `headerShown: false` for every screen, and supplying a custom `header`
 * function alone does NOT re-enable it. Without it the screen renders with no
 * header at all and its content sits under the status bar, which is what made
 * the title on Edit Profile collide with the notch.
 *
 * The header takes no title. Each screen already renders its own heading, and
 * duplicating it in the bar is what let four different product names drift
 * into the app.
 */
const screenHeader = {
  headerShown: true,
  header: () => <AppHeader />,
} as const;

/** Same header, used on the routes reachable without signing in. */
const publicScreen = screenHeader;

function RootNavigator() {
  const { session, profile, refreshProfile, signOut, profileUnavailable } = useAuth();
  const { seen: onboardingSeen } = useOnboardingSeen();
  const fontsReady = useAppFonts();
  const [signingOut, setSigningOut] = useState(false);

  // Wait for the session, the onboarding flag and the fonts before deciding
  // where to send the user. Otherwise a signed-in user briefly sees the
  // slides, a first-time user briefly sees the login screen, and every screen
  // flashes in the system face before swapping to Playfair and Source Sans.
  //
  // The profile is also awaited when there is a session, because the role
  // decides whether this device shows the app at all. Rendering the tabs first
  // and swapping them out once the role arrives would flash a practitioner
  // shell at an administrator.
  // A profile that failed to load is not pending: it gets its own screen below
  // rather than an endless spinner.
  const profilePending =
    session !== null && session !== undefined && profile === null && !profileUnavailable;
  const isLoading =
    session === undefined || onboardingSeen === undefined || !fontsReady || profilePending;

  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync();
    }
  }, [isLoading]);

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={palette.primary} size="large" />
      </View>
    );
  }

  if (session !== null && session !== undefined && profile === null && profileUnavailable) {
    return (
      <AccountUnavailable
        onRetry={refreshProfile}
        busy={signingOut}
        onSignOut={async () => {
          setSigningOut(true);
          try {
            await signOut();
          } finally {
            setSigningOut(false);
          }
        }}
      />
    );
  }

  // A member their branch has not approved sees nothing else. Administrators
  // never get this far: the auth provider closes their session before their
  // profile loads. The database is the boundary: it refuses an unapproved
  // member an invoice whatever this screen does.
  if (
    session !== null &&
    profile !== null &&
    !ADMIN_ROLES.includes(profile.role) &&
    profile.membership_status !== 'approved'
  ) {
    return (
      <MembershipPending
        profile={profile}
        onRefresh={refreshProfile}
        busy={signingOut}
        onSignOut={async () => {
          setSigningOut(true);
          try {
            await signOut();
          } finally {
            setSigningOut(false);
          }
        }}
      />
    );
  }

  // Route groups are guarded declaratively: expo-router only mounts the group
  // matching the current session state, so a signed-out user has no route into
  // the app shell at all. Server side RLS is still the real boundary; this is
  // navigation, not security.
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.background } }}>
      <Stack.Protected guard={session !== null}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="transaction/new" options={screenHeader} />
        <Stack.Screen name="transaction/[id]" options={screenHeader} />
        <Stack.Screen name="transaction/invoice/[id]" options={screenHeader} />
        <Stack.Screen name="notifications" options={screenHeader} />
        <Stack.Screen name="settings/notifications" options={screenHeader} />
        <Stack.Screen name="settings/security" options={screenHeader} />
        <Stack.Screen name="settings/help" options={screenHeader} />
        <Stack.Screen name="certificate/[id]" options={screenHeader} />
        <Stack.Screen name="profile/edit" options={screenHeader} />
        <Stack.Screen name="subscription/plans" options={screenHeader} />
        <Stack.Screen name="subscription/payment" options={screenHeader} />
        <Stack.Screen name="result" options={{ headerShown: false }} />
      </Stack.Protected>

      {/* First launch, signed out: the slides come before the login screen. */}
      <Stack.Protected guard={session === null && onboardingSeen === false}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>

      <Stack.Protected guard={session === null && onboardingSeen !== false}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>

      {/*
        Public verification sits outside every guard: a land registry clerk or
        opposing counsel checking a certificate will never have an account, so
        it has to work signed out. verify_rbin is the real boundary, exposing
        only what establishes authenticity.

        Declared LAST on purpose. When the session clears, the guarded group
        unmounts and the navigator falls back to the first route still
        mounted. With these declared before the auth group, logging out landed
        the user on the verification page instead of the login screen.
      */}
      <Stack.Screen name="verify/index" options={publicScreen} />
      <Stack.Screen name="verify/[rbin]" options={publicScreen} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.background,
  },
});
