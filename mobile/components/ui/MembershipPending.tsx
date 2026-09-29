import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { PRODUCT_NAME } from '@/lib/branding';
import type { Profile } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';

/**
 * Shown in place of the app to a member their branch has not yet approved.
 *
 * Branch decision, 29 September 2026: a new signup can do nothing until an
 * administrator of the branch approves it. A pending member sees this and a
 * way to check again. A rejected member sees the branch's reason and can
 * correct their details, including their SCN or branch, and resubmit.
 *
 * This is navigation, not security. The database refuses an unapproved member
 * an invoice, and only review_membership can approve them.
 */
export function MembershipPending({
  profile,
  onRefresh,
  onSignOut,
  busy,
}: {
  profile: Profile;
  onRefresh: () => Promise<void>;
  onSignOut: () => void;
  busy?: boolean;
}) {
  const rejected = profile.membership_status === 'rejected';

  const [checking, setChecking] = useState(false);
  const [fullName, setFullName] = useState(profile.full_name);
  const [scn, setScn] = useState(profile.scn ?? '');
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [branchCode, setBranchCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function checkAgain() {
    setChecking(true);
    try {
      await onRefresh();
    } finally {
      setChecking(false);
    }
  }

  async function resubmit() {
    setError(null);
    if (fullName.trim() === '' || scn.trim() === '') {
      setError('Enter your full name and Supreme Court Number.');
      return;
    }
    setSending(true);
    try {
      // The details first, directly: the database lets a member who is not yet
      // approved correct their own name, phone and SCN. The branch is the one
      // detail only the resubmission can change, since it is checked the way
      // signup checks it.
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ full_name: fullName.trim(), scn: scn.trim(), phone: phone.trim() || null })
        .eq('id', profile.id);
      if (updateError) {
        setError(
          updateError.code === '23505'
            ? 'That Supreme Court Number is already registered to another account.'
            : 'Your details could not be saved. Please try again.'
        );
        return;
      }

      const { error: rpcError } = await supabase.rpc('resubmit_membership', {
        p_branch_code: branchCode.trim() || null,
      });
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      await onRefresh();
    } finally {
      setSending(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.root} keyboardShouldPersistTaps="handled">
      <View style={[styles.iconCircle, rejected && styles.iconCircleRejected]}>
        <MaterialIcons
          name={rejected ? 'error-outline' : 'hourglass-top'}
          size={40}
          color={rejected ? palette.danger : palette.primary}
        />
      </View>

      <Text style={styles.title}>
        {rejected ? 'Your branch could not approve you' : 'Waiting for your branch'}
      </Text>

      {rejected ? (
        <>
          <View style={styles.reason}>
            <Text style={styles.reasonLabel}>Reason given</Text>
            <Text style={styles.reasonText}>
              {profile.membership_rejection_reason ?? 'No reason was recorded.'}
            </Text>
          </View>

          <Text style={styles.body}>
            Correct your details below and send them back to your branch. Leave the branch code
            empty unless you registered with the wrong branch.
          </Text>

          <View style={styles.form}>
            <TextField
              label="Full Name"
              value={fullName}
              onChangeText={setFullName}
              autoCapitalize="words"
            />
            <TextField
              label="Supreme Court Number (SCN)"
              value={scn}
              onChangeText={setScn}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <TextField
              label="Phone Number"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
            <TextField
              label="Branch Code (only if changing branch)"
              value={branchCode}
              onChangeText={setBranchCode}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="e.g. ANAOCHA"
            />
            {error !== null ? <Text style={styles.error}>{error}</Text> : null}
            <Button label="Send to my branch again" loading={sending} onPress={resubmit} />
          </View>
        </>
      ) : (
        <>
          <Text style={styles.body}>
            Your account has been created. An administrator of your branch has to confirm you are
            one of its members before you can use {PRODUCT_NAME}.
          </Text>
          <Text style={styles.body}>
            You will be able to continue as soon as they approve you. Check back here, or sign in
            again later.
          </Text>
          <View style={styles.action}>
            <Button label="Check again" loading={checking} onPress={checkAgain} />
          </View>
        </>
      )}

      <View style={styles.signOut}>
        <Button label="Sign out" variant="outline" loading={busy} onPress={onSignOut} />
      </View>

      <Text style={styles.footnote}>{PRODUCT_NAME}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    backgroundColor: palette.background,
  },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: radius.pill,
    backgroundColor: palette.successSurface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  iconCircleRejected: {
    backgroundColor: palette.dangerSurface,
  },
  title: {
    fontSize: fontSize.title,
    fontFamily: fontFamily.headingBold,
    fontWeight: fontWeight.bold,
    color: palette.text,
    textAlign: 'center',
  },
  body: {
    fontSize: fontSize.body,
    color: palette.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
    lineHeight: 21,
  },
  reason: {
    alignSelf: 'stretch',
    backgroundColor: palette.dangerSurface,
    borderRadius: radius.input,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  reasonLabel: {
    fontSize: fontSize.caption,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.danger,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  reasonText: {
    fontSize: fontSize.body,
    color: palette.danger,
    marginTop: spacing.xs,
    lineHeight: 21,
  },
  form: {
    alignSelf: 'stretch',
    marginTop: spacing.lg,
  },
  error: {
    fontSize: fontSize.label,
    color: palette.danger,
    marginBottom: spacing.md,
  },
  action: {
    marginTop: spacing.xl,
    alignSelf: 'stretch',
  },
  signOut: {
    marginTop: spacing.md,
    alignSelf: 'stretch',
  },
  footnote: {
    fontSize: fontSize.caption,
    color: palette.textDisabled,
    marginTop: spacing.xxl,
  },
});
