import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { PRODUCT_NAME } from '@/lib/branding';
import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';

/**
 * Shown when an administrator signs in on a phone or tablet.
 *
 * Client decision, 31 August 2026: administrator and practitioner are totally
 * separate. An administrator account administers and nothing else, and it does
 * so on the web console, where a verification queue can be laid out as a table
 * with the proof of payment beside it rather than stacked on a phone screen.
 *
 * A person who both administers a branch and practises law holds two accounts
 * and signs into this app with the practitioner one.
 *
 * This is navigation, not security. The real boundary is in the database:
 * create_transaction() refuses an administrator, and the insert policy on
 * transactions admits only branch_member. Removing this screen would not let
 * an administrator transact.
 */
export function AdminWebOnly({ onSignOut, busy }: { onSignOut: () => void; busy?: boolean }) {
  return (
    <View style={styles.root}>
      <View style={styles.iconCircle}>
        <MaterialIcons name="desktop-windows" size={40} color={palette.primary} />
      </View>

      <Text style={styles.title}>Administrators use the web console</Text>

      <Text style={styles.body}>
        This account administers a branch, so it does not carry a practitioner
        surface. Verification and certificate issuance happen on the web console,
        on a screen wide enough to show a payment proof beside the submission it
        belongs to.
      </Text>

      <Text style={styles.body}>
        If you also practise, sign in with your practitioner account instead. The
        two are deliberately kept separate, so that no one approves their own
        submission.
      </Text>

      <View style={styles.action}>
        <Button label="Sign out" variant="outline" loading={busy} onPress={onSignOut} />
      </View>

      <Text style={styles.footnote}>{PRODUCT_NAME}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
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
  action: {
    marginTop: spacing.xl,
    alignSelf: 'stretch',
  },
  footnote: {
    fontSize: fontSize.caption,
    color: palette.textDisabled,
    marginTop: spacing.xxl,
  },
});
