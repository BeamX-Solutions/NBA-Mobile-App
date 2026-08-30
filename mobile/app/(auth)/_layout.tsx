import { Stack } from 'expo-router';

import { palette } from '@/theme/tokens';

/**
 * The authentication screens carry no header.
 *
 * Each already renders the NBA seal and the product name in its own body, so
 * a header logo would simply duplicate it, and the shared header's signed-out
 * action is a "Log in" button, which is meaningless on the login screen
 * itself. They navigate between one another through their own links
 * ("Register here", "Already have an account? Log In", "Back to Login"), so
 * nothing is lost by removing the bar.
 */
export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: palette.background },
      }}
    />
  );
}
