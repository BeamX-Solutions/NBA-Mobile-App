import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { ATTRIBUTION, PRODUCT_NAME, PRODUCT_TAGLINE } from '@/lib/branding';
import { supabase } from '@/lib/supabase';
import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleLogin() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        // Deliberately generic: distinguishing "no such account" from "wrong
        // password" tells an attacker which emails are registered.
        setSubmitError('That email address and password did not match.');
      }
      // On success the auth listener updates the session and the root layout
      // swaps to the app shell, so there is nothing to navigate here.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen style={styles.screen}>
      <Card>
        <View style={styles.brand}>
          <Image
            source={require('@/assets/images/nba-logo.png')}
            style={styles.logo}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
          <Text style={styles.title}>{PRODUCT_NAME}</Text>
          <Text style={styles.subtitle}>Log in to access your dashboard and calculator.</Text>
        </View>

        <Text style={styles.label}>Email Address</Text>
        <View style={styles.control}>
          <TextInput
            placeholder="Enter your registered email"
            placeholderTextColor={palette.textDisabled}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
            style={styles.input}
          />
        </View>

        <View style={styles.passwordLabelRow}>
          <Text style={styles.label}>Password</Text>
          <Link href="/(auth)/forgot-password" style={styles.forgot}>
            Forgot Password?
          </Link>
        </View>
        <View style={styles.control}>
          <TextInput
            placeholder="Enter your password"
            placeholderTextColor={palette.textDisabled}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            value={password}
            onChangeText={setPassword}
            style={styles.input}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            onPress={() => setShowPassword((previous) => !previous)}
            hitSlop={10}>
            <MaterialIcons
              name={showPassword ? 'visibility' : 'visibility-off'}
              size={22}
              color={palette.textMuted}
            />
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: rememberMe }}
          onPress={() => setRememberMe((previous) => !previous)}
          style={styles.rememberRow}>
          <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
            {rememberMe ? (
              <MaterialIcons name="check" size={14} color={palette.textInverse} />
            ) : null}
          </View>
          <Text style={styles.rememberLabel}>Remember Me</Text>
        </Pressable>

        {submitError !== null ? <Text style={styles.error}>{submitError}</Text> : null}

        <Button label="Log In" onPress={handleLogin} loading={submitting} />

        <View style={styles.divider} />

        <View style={styles.footer}>
          <Text style={styles.footerText}>Don&apos;t have an account? </Text>
          <Link href="/(auth)/register" style={styles.footerLink}>
            Register here
          </Link>
        </View>
      </Card>

      <Text style={styles.attribution}>{ATTRIBUTION}</Text>
      <Text style={styles.tagline}>{PRODUCT_TAGLINE}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    justifyContent: 'center',
    flexGrow: 1,
  },
  brand: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  logo: {
    width: 92,
    height: 92,
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: fontSize.heading,
    fontFamily: fontFamily.headingBold,
    fontWeight: fontWeight.bold,
    color: palette.text,
  },
  subtitle: {
    fontSize: fontSize.body,
    color: palette.textMuted,
    marginTop: spacing.sm,
    textAlign: 'center',
    lineHeight: 21,
  },
  label: {
    fontSize: fontSize.label,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
    color: palette.text,
    marginBottom: spacing.sm,
  },
  passwordLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  forgot: {
    fontSize: fontSize.label,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
    color: palette.primary,
    marginBottom: spacing.sm,
  },
  control: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: radius.input,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
    minHeight: 50,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: fontSize.bodyLarge,
    color: palette.text,
    paddingVertical: spacing.md,
  },
  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: palette.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: palette.primary,
    borderColor: palette.primary,
  },
  rememberLabel: {
    fontSize: fontSize.bodyLarge,
    color: palette.text,
  },
  error: {
    fontSize: fontSize.label,
    color: palette.danger,
    marginBottom: spacing.md,
  },
  divider: {
    height: 1,
    backgroundColor: palette.border,
    marginVertical: spacing.lg,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  footerText: {
    fontSize: fontSize.label,
    color: palette.textMuted,
  },
  footerLink: {
    fontSize: fontSize.label,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.primary,
  },
  attribution: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
    textAlign: 'center',
    marginTop: spacing.xl,
    letterSpacing: 0.5,
  },
  tagline: {
    fontSize: fontSize.caption,
    color: palette.textDisabled,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
});
