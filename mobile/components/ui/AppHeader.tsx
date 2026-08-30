import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth-context';
import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';

interface AppHeaderProps {
  /** Practitioner photo. Falls back to a person glyph when not set. */
  avatarUrl?: string | null;
}

/**
 * The bar at the top of every screen: the NBA seal on the left, and on the
 * right either the practitioner's avatar or, when signed out, a way back in.
 *
 * There is deliberately no screen title and no back arrow. Titles duplicated
 * the heading each screen already renders, and drifted (four different product
 * names ended up in the app that way). Back navigation is handled by the
 * system: the iOS edge swipe and the Android back button, both of which work
 * on every pushed screen.
 */
export function AppHeader({ avatarUrl }: AppHeaderProps) {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const signedIn = session !== null && session !== undefined;

  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Home"
        onPress={() => {
          if (signedIn) {
            router.navigate('/(tabs)');
          }
        }}
        disabled={!signedIn}
        hitSlop={8}>
        <Image
          source={require('@/assets/images/nba-logo.png')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      </Pressable>

      <View style={styles.spacer} />

      {signedIn ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Profile"
          onPress={() => router.navigate('/(tabs)/profile')}
          hitSlop={8}
          style={styles.avatar}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
          ) : (
            <MaterialIcons name="person" size={22} color={palette.textMuted} />
          )}
        </Pressable>
      ) : (
        /*
          Signed out, the avatar would lead nowhere. The public verification
          page is reachable without an account, so someone can legitimately be
          on a screen with no way back into the app: this is that way back.
        */
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Log in"
          onPress={() => router.replace('/(auth)/login')}
          style={({ pressed }) => [styles.loginButton, pressed && styles.loginButtonPressed]}>
          <MaterialIcons name="login" size={18} color={palette.textInverse} />
          <Text style={styles.loginLabel}>Log in</Text>
        </Pressable>
      )}
    </View>
  );
}

const AVATAR_SIZE = 38;

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: palette.background,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  logo: {
    width: 36,
    height: 36,
  },
  spacer: {
    flex: 1,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
  },
  loginButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: palette.primary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  loginButtonPressed: {
    backgroundColor: palette.primaryPressed,
  },
  loginLabel: {
    fontSize: fontSize.label,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
    color: palette.textInverse,
  },
});
