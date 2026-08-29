import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, type ComponentProps } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontFamily, fontSize, fontWeight, palette, spacing } from '@/theme/tokens';

type IconName = ComponentProps<typeof MaterialIcons>['name'];

/**
 * Height of AppHeader below the safe area: the 36px logo plus its vertical
 * padding and the hairline border. Used to offset the keyboard avoider.
 */
const HEADER_CONTENT_HEIGHT = 36 + 8 + 12 + 1;

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
  const insets = useSafeAreaInsets();

  // The shared header sits above this view, so the keyboard offset has to
  // account for it or iOS lifts the content by too little and the focused
  // field stays under the keyboard.
  const headerHeight = insets.top + HEADER_CONTENT_HEIGHT;

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
        The keyboard covers whatever is being typed when a field sits low on
        the page. KeyboardAvoidingView lifts the content instead.
        The behaviour differs by platform on purpose: iOS needs 'padding',
        since the keyboard overlays the view and nothing else moves; Android
        resizes the window itself, so 'height' cooperates with that rather
        than double-shifting the layout.
      */
      <KeyboardAvoidingView
        style={styles.page}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}>
        <ScrollView
          ref={scrollRef}
          style={styles.page}
          contentContainerStyle={[styles.content, style]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          // Keeps a focused field visible above the keyboard rather than
          // flush against it, so the next field is still reachable.
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
      </KeyboardAvoidingView>
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
