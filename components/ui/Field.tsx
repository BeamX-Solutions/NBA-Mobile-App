import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';

interface FieldWrapperProps {
  label: string;
  /** Helper text shown under the control, as in "Value of the property or transaction." */
  hint?: string;
  /** Validation message. When set, the control is outlined in red. */
  error?: string;
  children: React.ReactNode;
}

export function Field({ label, hint, error, children }: FieldWrapperProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {error !== undefined ? (
        <Text style={styles.error}>{error}</Text>
      ) : hint !== undefined ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  hint?: string;
  error?: string;
  /** Fixed text shown inside the input before the value, for example "₦" or "SCN-". */
  prefix?: string;
  /** Renders the value greyed and blocks editing, as SCN is on Edit Profile. */
  locked?: boolean;
}

export function TextField({ label, hint, error, prefix, locked, ...rest }: TextFieldProps) {
  return (
    <Field label={label} hint={hint} error={error}>
      <View
        style={[
          styles.control,
          styles.inputRow,
          error !== undefined && styles.controlError,
          locked === true && styles.locked,
        ]}>
        {prefix !== undefined ? <Text style={styles.prefix}>{prefix}</Text> : null}
        <TextInput
          {...rest}
          editable={locked !== true && rest.editable !== false}
          placeholderTextColor={palette.textDisabled}
          style={[styles.input, locked === true && styles.lockedText]}
        />
      </View>
    </Field>
  );
}

interface SelectFieldProps<T extends string> {
  label: string;
  hint?: string;
  error?: string;
  value: T | '';
  onChange: (value: T) => void;
  placeholder: string;
  options: readonly { value: T; label: string }[];
  /** Renders the closed control greyed and non-interactive. */
  locked?: boolean;
}

/** Above this many options the sheet gains a search box. */
const SEARCH_THRESHOLD = 10;

/**
 * Dropdown for State of Transaction, Document Type, Branch and Practice State.
 *
 * This is a modal sheet rather than @react-native-picker/picker. That package
 * renders an inline spinning wheel on iOS, which consumed most of the screen
 * and looked nothing like the compact bordered control in the designs, while
 * rendering as a native dropdown on Android: two very different screens from
 * one component. A sheet looks the same on both, matches the mockups, and
 * removes a native module Expo Go may not bundle.
 */
export function SelectField<T extends string>({
  label,
  hint,
  error,
  value,
  onChange,
  placeholder,
  options,
  locked,
}: SelectFieldProps<T>) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = options.find((option) => option.value === value);
  const showSearch = options.length > SEARCH_THRESHOLD;

  const visible = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (trimmed === '') {
      return options;
    }
    return options.filter((option) => option.label.toLowerCase().includes(trimmed));
  }, [options, query]);

  function close() {
    setOpen(false);
    setQuery('');
  }

  return (
    <Field label={label} hint={hint} error={error}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${selected?.label ?? placeholder}`}
        accessibilityState={{ disabled: locked === true, expanded: open }}
        disabled={locked === true}
        onPress={() => setOpen(true)}
        style={[
          styles.control,
          styles.selectBox,
          error !== undefined && styles.controlError,
          locked === true && styles.locked,
        ]}>
        <Text
          numberOfLines={1}
          style={[
            styles.selectText,
            selected === undefined && styles.selectPlaceholder,
            locked === true && styles.lockedText,
          ]}>
          {selected?.label ?? placeholder}
        </Text>
        <MaterialIcons
          name="expand-more"
          size={22}
          color={locked === true ? palette.textDisabled : palette.textMuted}
        />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={close}
        statusBarTranslucent>
        <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.grabber} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{label}</Text>
            <Pressable onPress={close} hitSlop={12} accessibilityRole="button">
              <MaterialIcons name="close" size={24} color={palette.textMuted} />
            </Pressable>
          </View>

          {showSearch ? (
            <View style={[styles.control, styles.inputRow, styles.searchRow]}>
              <MaterialIcons name="search" size={20} color={palette.textMuted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search"
                placeholderTextColor={palette.textDisabled}
                autoCorrect={false}
                style={styles.input}
              />
            </View>
          ) : null}

          <FlatList
            data={visible}
            keyExtractor={(option) => option.value}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            ListEmptyComponent={<Text style={styles.empty}>No matches.</Text>}
            renderItem={({ item }) => {
              const isSelected = item.value === value;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => {
                    onChange(item.value);
                    close();
                  }}
                  style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}>
                  <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                    {item.label}
                  </Text>
                  {isSelected ? (
                    <MaterialIcons name="check" size={20} color={palette.primary} />
                  ) : null}
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </Field>
  );
}

const styles = StyleSheet.create({
  field: {
    marginBottom: spacing.lg,
  },
  label: {
    fontSize: fontSize.label,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
    color: palette.text,
    marginBottom: spacing.sm,
  },
  control: {
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: radius.input,
    backgroundColor: palette.surface,
  },
  controlError: {
    borderColor: palette.danger,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    minHeight: 50,
  },
  prefix: {
    fontSize: fontSize.bodyLarge,
    color: palette.text,
    marginRight: spacing.xs,
  },
  input: {
    flex: 1,
    fontSize: fontSize.bodyLarge,
    color: palette.text,
    paddingVertical: spacing.md,
  },
  locked: {
    backgroundColor: palette.surfaceMuted,
  },
  lockedText: {
    color: palette.textMuted,
  },
  selectBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    minHeight: 50,
  },
  selectText: {
    flex: 1,
    fontSize: fontSize.bodyLarge,
    color: palette.text,
  },
  selectPlaceholder: {
    color: palette.textDisabled,
  },
  backdrop: {
    flex: 1,
    backgroundColor: palette.scrim,
  },
  sheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    maxHeight: '70%',
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: palette.border,
    marginBottom: spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sheetTitle: {
    fontSize: fontSize.title,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.text,
  },
  searchRow: {
    marginBottom: spacing.sm,
  },
  list: {
    flexGrow: 0,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  optionPressed: {
    backgroundColor: palette.surfaceMuted,
  },
  optionText: {
    fontSize: fontSize.bodyLarge,
    color: palette.text,
  },
  optionTextSelected: {
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.primary,
  },
  empty: {
    fontSize: fontSize.body,
    color: palette.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
  hint: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
    marginTop: spacing.xs,
  },
  error: {
    fontSize: fontSize.caption,
    color: palette.danger,
    marginTop: spacing.xs,
  },
});
