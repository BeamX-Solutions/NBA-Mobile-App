import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Link } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SelectField, TextField } from '@/components/ui/Field';
import { Screen, ScreenHeading } from '@/components/ui/Screen';
import type { SignupMetadata } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
import { fontFamily, fontSize, fontWeight, palette, spacing } from '@/theme/tokens';

/** Row returned by list_branches_for_signup(). */
interface SignupBranch {
  id: string;
  branch_code: string;
  name: string;
  state: string;
}

export default function RegisterScreen() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [scn, setScn] = useState('');
  const [branchCode, setBranchCode] = useState<string | ''>('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [branches, setBranches] = useState<SignupBranch[] | null>(null);
  const [branchLoadError, setBranchLoadError] = useState<string | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** Set when the account was created but needs the email confirming first. */
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  /*
    Branches are read through a function, not the table. This screen runs
    before the user has an account, and the policy on public.branches admits
    only authenticated readers. Opening that policy to anon would have
    published every branch's account number alongside its name.
  */
  const loadBranches = useCallback(async () => {
    setBranchLoadError(null);
    const { data, error } = await supabase.rpc('list_branches_for_signup');
    if (error) {
      setBranchLoadError('The list of branches could not be loaded.');
      return;
    }
    setBranches((data ?? []) as SignupBranch[]);
  }, []);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  const selectedBranch = branches?.find((branch) => branch.branch_code === branchCode) ?? null;

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};

    if (fullName.trim() === '') {
      next.fullName = 'Enter your full name as on your Call to Bar certificate.';
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      next.email = 'Enter a valid email address.';
    }
    if (scn.trim() === '') {
      next.scn = 'Enter your Supreme Court Number.';
    }
    if (branchCode === '') {
      next.branchCode = 'Select the NBA branch you belong to.';
    }
    if (password.length < 8) {
      next.password = 'Use at least 8 characters.';
    }
    if (confirmPassword !== password) {
      next.confirmPassword = 'The passwords do not match.';
    }
    return next;
  }

  async function handleSubmit() {
    const nextErrors = validate();
    setErrors(nextErrors);
    setSubmitError(null);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setSubmitting(true);
    try {
      // The code came from the dropdown, so it is known valid. No
      // validate_branch_code round trip is needed, and practice_state is not
      // sent at all: the database derives it from the branch, which stops the
      // two disagreeing.
      const metadata: SignupMetadata = {
        full_name: fullName.trim(),
        phone: phone.trim() || undefined,
        scn: scn.trim() || undefined,
        branch_code: branchCode,
      };

      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: metadata },
      });

      if (error) {
        setSubmitError(error.message);
        return;
      }

      // With email confirmation enabled, signUp creates the account but
      // returns no session, so there is nothing to navigate into yet. With it
      // disabled, a session arrives and the root layout swaps to the app on
      // its own. Handling both means this works either way, and the Supabase
      // setting can be changed without touching this code.
      if (data.session === null) {
        setAwaitingConfirmation(true);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (awaitingConfirmation) {
    return (
      <Screen style={styles.centered}>
        <Card>
          <View style={styles.confirmBlock}>
            <MaterialIcons name="mark-email-unread" size={48} color={palette.primary} />
            <Text style={styles.confirmTitle}>Confirm your email</Text>
            <Text style={styles.confirmBody}>
              We have sent a confirmation link to {email.trim()}. Open it to activate your account,
              then log in.
            </Text>
            <Text style={styles.confirmHint}>
              Check your spam folder if it has not arrived within a few minutes.
            </Text>
          </View>
          <Link href="/(auth)/login" style={styles.confirmLink}>
            Go to Log In
          </Link>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.brand}>
        <Image
          source={require('@/assets/images/nba-logo.png')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      </View>

      <ScreenHeading
        title="Create Account"
        subtitle="Register as a legal practitioner to access official services and fee calculators."
      />

      <Card>
        <TextField
          label="Full Name (As on Call to Bar Certificate)"
          placeholder="e.g. Jane Doe"
          autoCapitalize="words"
          value={fullName}
          onChangeText={setFullName}
          error={errors.fullName}
        />

        <TextField
          label="Official Email Address"
          placeholder="jane.doe@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          value={email}
          onChangeText={setEmail}
          error={errors.email}
        />

        <TextField
          label="Phone Number"
          placeholder="+234 800 000 0000"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
          error={errors.phone}
        />

        <TextField
          label="Supreme Court Number (SCN)"
          prefix="SCN-"
          placeholder="123456"
          autoCapitalize="characters"
          value={scn}
          onChangeText={setScn}
          error={errors.scn}
        />

        {/*
          Selected, not typed, and required. Every practitioner belongs to a
          branch, and the branch decides who verifies their payments and
          issues their certificates, so there is no useful account without
          one. Typing a code invited typos that only surfaced after the
          account had been created.
        */}
        <SelectField
          label="NBA Branch"
          placeholder={branches === null ? 'Loading branches...' : 'Select your branch'}
          value={branchCode}
          onChange={setBranchCode}
          options={(branches ?? []).map((branch) => ({
            value: branch.branch_code,
            label: branch.name,
          }))}
          error={errors.branchCode ?? branchLoadError ?? undefined}
          hint={
            selectedBranch !== null
              ? `Your practice state is recorded as ${selectedBranch.state}, taken from this branch.`
              : 'Ask your branch secretariat if you are unsure which to choose.'
          }
        />

        {branchLoadError !== null ? (
          <Button label="Retry loading branches" variant="outline" onPress={loadBranches} />
        ) : null}

        <TextField
          label="Password"
          placeholder="At least 8 characters"
          secureTextEntry
          autoCapitalize="none"
          value={password}
          onChangeText={setPassword}
          error={errors.password}
        />

        <TextField
          label="Confirm Password"
          placeholder="Re-enter your password"
          secureTextEntry
          autoCapitalize="none"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          error={errors.confirmPassword}
        />

        {submitError !== null ? <Text style={styles.submitError}>{submitError}</Text> : null}

        <Button label="Proceed" onPress={handleSubmit} loading={submitting} />

        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <Link href="/(auth)/login" style={styles.footerLink}>
            Log In
          </Link>
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: {
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  logo: {
    width: 64,
    height: 64,
  },
  centered: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  confirmBlock: {
    alignItems: 'center',
    gap: spacing.md,
  },
  confirmTitle: {
    fontSize: fontSize.title,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.text,
  },
  confirmBody: {
    fontSize: fontSize.body,
    color: palette.text,
    textAlign: 'center',
    lineHeight: 22,
  },
  confirmHint: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
    textAlign: 'center',
  },
  confirmLink: {
    fontSize: fontSize.bodyLarge,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.primary,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  submitError: {
    fontSize: fontSize.label,
    color: palette.danger,
    marginBottom: spacing.md,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.lg,
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
});
