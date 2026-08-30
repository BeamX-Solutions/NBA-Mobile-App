import { Link } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/Field';
import { Screen } from '@/components/ui/Screen';
import { supabase } from '@/lib/supabase';
import { fontFamily, fontSize, fontWeight, palette, spacing } from '@/theme/tokens';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSend() {
    setSubmitting(true);
    try {
      await supabase.auth.resetPasswordForEmail(email.trim());
      // Always report success. Confirming whether an address is registered
      // would leak which practitioners hold accounts.
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen style={styles.screen}>
      <Card>
        <View style={styles.header}>
          <Text style={styles.title}>Forgot Password</Text>
          <Text style={styles.subtitle}>
            Enter your registered email address to receive a password reset link.
          </Text>
        </View>

        {sent ? (
          <Text style={styles.sent}>
            If that address is registered, a reset link is on its way. Check your inbox and your
            spam folder.
          </Text>
        ) : (
          <>
            <TextField
              label="Email Address"
              placeholder="practitioner@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              value={email}
              onChangeText={setEmail}
            />
            <Button label="Send Reset Link" onPress={handleSend} loading={submitting} />
          </>
        )}

        <Link href="/(auth)/login" style={styles.back}>
          Back to Login
        </Link>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    justifyContent: 'center',
    flexGrow: 1,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: fontSize.heading,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.text,
  },
  subtitle: {
    fontSize: fontSize.body,
    color: palette.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 21,
  },
  sent: {
    fontSize: fontSize.body,
    color: palette.success,
    textAlign: 'center',
    lineHeight: 22,
    paddingVertical: spacing.lg,
  },
  back: {
    fontSize: fontSize.label,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
    color: palette.primary,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
