import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { Screen, ScreenHeading, SectionTitle } from '@/components/ui/Screen';
import { fontFamily, fontSize, fontWeight, palette, spacing } from '@/theme/tokens';

interface Preference {
  key: string;
  label: string;
  description: string;
  /** Notices about money or legal standing default on and can be turned off. */
  defaultOn: boolean;
}

const preferences: readonly Preference[] = [
  {
    key: 'verification',
    label: 'Payment verification',
    description: 'When your branch verifies or rejects proof of payment you have submitted.',
    defaultOn: true,
  },
  {
    key: 'certificate',
    label: 'Certificate issued',
    description: 'When a Certificate of Compliance and BAIN are issued to you.',
    defaultOn: true,
  },
  {
    key: 'subscription',
    label: 'Subscription reminders',
    description: 'Before your subscription expires, so calculations do not stop unexpectedly.',
    defaultOn: true,
  },
  {
    key: 'scale',
    label: 'Fee scale changes',
    description: 'When the Remuneration Order is amended and the calculator is updated.',
    defaultOn: true,
  },
  {
    key: 'announcements',
    label: 'Branch announcements',
    description: 'General notices from your branch that are not about your own transactions.',
    defaultOn: false,
  },
];

/**
 * Preferences are local only for now.
 *
 * Delivery is not built: there is no push token registration and no server
 * side sender, so nothing here changes what actually reaches the practitioner
 * yet. The screen exists so the row on Profile leads somewhere real and so
 * the preference set is settled before delivery is wired up.
 */
export default function NotificationSettingsScreen() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(preferences.map((preference) => [preference.key, preference.defaultOn]))
  );

  return (
    <Screen>
      <ScreenHeading
        title="Notification Settings"
        subtitle="Choose what you are told about, and when."
      />

      <Card>
        <SectionTitle icon="notifications-none" underline>
          Notify me about
        </SectionTitle>

        {preferences.map((preference, index) => (
          <View
            key={preference.key}
            style={[styles.row, index === preferences.length - 1 && styles.rowLast]}>
            <View style={styles.rowText}>
              <Text style={styles.label}>{preference.label}</Text>
              <Text style={styles.description}>{preference.description}</Text>
            </View>
            <Switch
              value={enabled[preference.key]}
              onValueChange={(value) =>
                setEnabled((current) => ({ ...current, [preference.key]: value }))
              }
              trackColor={{ false: palette.borderStrong, true: palette.primary }}
              thumbColor={palette.surface}
            />
          </View>
        ))}
      </Card>

      <Text style={styles.note}>
        Push delivery is not enabled yet, so these preferences are saved on this device only. They
        will apply once notifications are switched on.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowText: {
    flex: 1,
  },
  label: {
    fontSize: fontSize.body,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
    color: palette.text,
  },
  description: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
    marginTop: spacing.xs,
    lineHeight: 17,
  },
  note: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
    textAlign: 'center',
    marginTop: spacing.lg,
    lineHeight: 17,
  },
});
