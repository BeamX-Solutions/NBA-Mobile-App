import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';

type Variant = 'primary' | 'outline' | 'danger';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

/**
 * The mockups use three button shapes: solid green (Calculate Fee, Proceed),
 * green outline (Load More Transactions, Cancel), and red outline (Log Out).
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && {
          backgroundColor: pressed ? palette.primaryPressed : palette.primary,
        },
        variant === 'outline' && [styles.outline, pressed && styles.outlinePressed],
        variant === 'danger' && [styles.dangerOutline, pressed && styles.dangerPressed],
        isDisabled && styles.disabled,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? palette.textInverse : palette.primary} />
      ) : (
        <Text
          style={[
            styles.label,
            variant === 'primary' && { color: palette.textInverse },
            variant === 'outline' && { color: palette.primary },
            variant === 'danger' && { color: palette.danger },
          ]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.button,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  outline: {
    borderWidth: 1.5,
    borderColor: palette.primary,
    backgroundColor: palette.surface,
  },
  outlinePressed: {
    backgroundColor: palette.successSurface,
  },
  dangerOutline: {
    borderWidth: 1.5,
    borderColor: palette.danger,
    backgroundColor: palette.surface,
  },
  dangerPressed: {
    backgroundColor: palette.dangerSurface,
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    fontSize: fontSize.bodyLarge,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
  },
});
