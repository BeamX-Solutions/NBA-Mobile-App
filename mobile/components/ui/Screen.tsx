import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, type ComponentProps } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewProps,
} from 'react-native';

import { fontFamily, fontSize, fontWeight, palette, spacing } from '@/theme/tokens';

type IconName = ComponentProps<typeof MaterialIcons>['name'];

interface ScreenProps extends ViewProps {
  scroll?: boolean;
  /** Supplying this enables pull to refresh. */
  onRefresh?: () => void;
  refreshing?: boolean;
  /**
   * Start at the top each time this screen is focused.
   *
   * Only the four bottom tabs set this. They persist between visits, so
   * without it a tab reopens at whatever offset you left it at, which reads
   * as landing halfway down a page you have not seen. Pushed screens are
   * mounted fresh and already begin at the top, and resetting them would
   * throw away the scroll position a user expects to keep when returning
   * from a detail screen.
   */
  resetScrollOnFocus?: boolean;
}

/** Page background with consistent padding. */
export function Screen({
  scroll = true,
  onRefresh,
  refreshing = false,
  resetScrollOnFocus = false,
  children,
  style,
  ...rest
}: ScreenProps) {
  const scrollRef = useRef<ScrollView>(null);

  useFocusEffect(
    useCallback(() => {
      if (resetScrollOnFocus) {
        // Unanimated: it should look like the screen was always at the top,
        // not like it scrolled while the user watched.
        scrollRef.current?.scrollTo({ y: 0, animated: false });
      }
    }, [resetScrollOnFocus])
  );

  if (scroll) {
    return (
      /*
        One mechanism makes room for the keyboard, not three.

        This screen used to wrap the list in a KeyboardAvoidingView as well as
        setting automaticallyAdjustKeyboardInsets on the ScrollView, on a
        platform that already resizes the window itself. Each of those lifts
        the content by about the height of the keyboard, so the content moved
        by roughly twice what was needed and the field being typed into was
        pushed off the top of the screen. It looked like the layout had jumped
        and could only be recovered by scrolling back down, which is the
        opposite of what any of the three was for.

        What remains is the one that fits a scrolling form on each platform.
        On iOS automaticallyAdjustKeyboardInsets adds a content inset, which
        keeps the focused field above the keyboard and leaves the rest of the
        page reachable by scrolling. On Android the window is resized by the
        system, so the ScrollView is already shorter and needs no help. The
        prop is iOS only and is ignored there.
      */
      <ScrollView
        ref={scrollRef}
        style={styles.page}
        contentContainerStyle={[styles.content, style]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        refreshControl={
          onRefresh !== undefined ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={palette.primary}
              colors={[palette.primary]}
            />
          ) : undefined
        }>
        {children}
      </ScrollView>
    );
  }
  return (
    <View {...rest} style={[styles.page, styles.content, style]}>
      {children}
    </View>
  );
}

/** Screen title and supporting line, as on Transactions and Upload Proof. */
export function ScreenHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.heading}>
      <Text style={styles.title}>{title}</Text>
      {subtitle !== undefined ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

/**
 * Section label inside a card. The mockups pair each heading with a small
 * green icon and, on the Profile screen, underline the row.
 */
export function SectionTitle({
  children,
  icon,
  underline = false,
}: {
  children: React.ReactNode;
  icon?: IconName;
  underline?: boolean;
}) {
  return (
    <View style={[styles.sectionRow, underline && styles.sectionRowUnderline]}>
      {icon !== undefined ? (
        <MaterialIcons name={icon} size={20} color={palette.primaryText} />
      ) : null}
      <Text style={styles.sectionTitle}>{children}</Text>
    </View>
  );
}

/** Tappable row with a leading icon and trailing chevron, as in Account Settings. */
export function SettingsRow({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.settingsRow, pressed && styles.settingsRowPressed]}>
      <MaterialIcons name={icon} size={20} color={palette.textMuted} />
      <Text style={styles.settingsLabel}>{label}</Text>
      <MaterialIcons name="chevron-right" size={22} color={palette.textDisabled} />
    </Pressable>
  );
}

/** Label and value pair used on the certificate and profile screens. */
export function DetailRow({
  label,
  value,
  emphasise = false,
}: {
  label: string;
  value: string;
  emphasise?: boolean;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, emphasise && styles.detailValueEmphasis]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: palette.background,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  heading: {
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: fontSize.heading,
    // Playfair, matching the portal's rule that h1 to h6 use the heading face.
    fontFamily: fontFamily.headingBold,
    fontWeight: fontWeight.bold,
    color: palette.text,
  },
  subtitle: {
    fontSize: fontSize.body,
    color: palette.textMuted,
    marginTop: spacing.xs,
    lineHeight: 21,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sectionRowUnderline: {
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    paddingBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: fontSize.bodyLarge,
    fontFamily: fontFamily.heading,
    fontWeight: fontWeight.bold,
    color: palette.primaryText,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  settingsRowPressed: {
    backgroundColor: palette.surfaceMuted,
  },
  settingsLabel: {
    flex: 1,
    fontSize: fontSize.body,
    color: palette.text,
  },
  detailRow: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  detailLabel: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  detailValue: {
    fontSize: fontSize.body,
    color: palette.text,
  },
  detailValueEmphasis: {
    fontSize: fontSize.bodyLarge,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
  },
});
