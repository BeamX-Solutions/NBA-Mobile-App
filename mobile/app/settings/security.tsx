import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/Field';
import { DetailRow, Screen, ScreenHeading, SectionTitle } from '@/components/ui/Screen';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { fontSize, palette, spacing } from '@/theme/tokens';

export default function SecurityScreen() {
  const { session, profile } = useAuth();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function changePassword() {
    const next: Record<string, string> = {};
    if (password.length < 8) {
      next.password = 'Use at least 8 characters.';
    }
    if (confirmPassword !== password) {
      next.confirmPassword = 'The passwords do not match.';
    }
    setErrors(next);
    setMessage(null);
    setFailure(null);
    if (Object.keys(next).length > 0) {
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setFailure(error.message);
        return;
      }
      setPassword('');
      setConfirmPassword('');
      setMessage('Your password has been changed.');
    } finally {
      setSaving(false);
    }
  }

  const lastSignIn = session?.user.last_sign_in_at;

  return (
    <Screen>
      <ScreenHeading title="Security" subtitle="Manage how you sign in to your account." />

      <Card>
        <SectionTitle icon="lock-outline" underline>
          Change password
        </SectionTitle>

        <TextField
          label="New Password"
          placeholder="At least 8 characters"
          secureTextEntry
          autoCapitalize="none"
          value={password}
          onChangeText={setPassword}
          error={errors.password}
        />
        <TextField
          label="Confirm New Password"
          placeholder="Re-enter the new password"
          secureTextEntry
          autoCapitalize="none"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          error={errors.confirmPassword}
        />

        {failure !== null ? <Text style={styles.failure}>{failure}</Text> : null}
        {message !== null ? <Text style={styles.success}>{message}</Text> : null}

        <Button label="Update Password" onPress={changePassword} loading={saving} />
      </Card>

      <Card style={styles.card}>
        <SectionTitle icon="badge" underline>
          Account
        </SectionTitle>
        <DetailRow label="Email" value={profile?.email ?? session?.user.email ?? 'Not set'} />
        <DetailRow
          label="Last signed in"
          value={lastSignIn ? new Date(lastSignIn).toLocaleString() : 'Not recorded'}
        />
      </Card>

      <Text style={styles.note}>
        Your Supreme Court Number and branch cannot be changed here. They identify you on
        certificates that carry legal weight, so a branch administrator has to make those changes.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.lg,
  },
  failure: {
    fontSize: fontSize.label,
    color: palette.danger,
    marginBottom: spacing.md,
  },
  success: {
    fontSize: fontSize.label,
    color: palette.primary,
    marginBottom: spacing.md,
  },
  note: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
    textAlign: 'center',
    marginTop: spacing.lg,
    lineHeight: 17,
  },
});
