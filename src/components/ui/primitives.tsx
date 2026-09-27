/** Small shared building blocks so screens stay consistent. */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing, TOUCH_TARGET, typography } from '@/theme/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

// --- Screen -----------------------------------------------------------------

interface ScreenProps {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  /** Set false for screens that manage their own scrolling (lists, chat). */
  scroll?: boolean;
}

export function Screen({ title, subtitle, right, children, scroll = true }: ScreenProps) {
  const header = (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text style={typography.title} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {scroll ? (
        <KeyboardAwareScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          bottomOffset={spacing.lg}
        >
          {header}
          {children}
        </KeyboardAwareScrollView>
      ) : (
        <View style={styles.fill}>
          <View style={styles.fixedHeader}>{header}</View>
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}

// --- Card -------------------------------------------------------------------

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

// --- Button -----------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface AppButtonProps {
  label: string;
  onPress: () => void;
  icon?: IconName;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  large?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

const BUTTON_COLORS: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.primary, fg: colors.onPrimary, border: colors.primary },
  secondary: { bg: colors.surfaceRaised, fg: colors.text, border: colors.border },
  danger: { bg: colors.danger, fg: '#FFFFFF', border: colors.danger },
  ghost: { bg: 'transparent', fg: colors.primary, border: colors.border },
};

export function AppButton({
  label,
  onPress,
  icon,
  variant = 'primary',
  disabled,
  loading,
  large,
  style,
  accessibilityHint,
}: AppButtonProps) {
  const palette = BUTTON_COLORS[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        large && styles.buttonLarge,
        { backgroundColor: palette.bg, borderColor: palette.border },
        pressed && styles.pressed,
        inactive && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : icon ? (
        <Ionicons name={icon} size={large ? 24 : 18} color={palette.fg} />
      ) : null}
      <Text style={[styles.buttonLabel, large && styles.buttonLabelLarge, { color: palette.fg }]}>{label}</Text>
    </Pressable>
  );
}

// --- Segmented control -----------------------------------------------------

interface SegmentedProps<T extends string> {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  return (
    <View style={styles.segmented} accessibilityRole="radiogroup">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={[styles.segment, selected && styles.segmentSelected]}
          >
            <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// --- Stepper ----------------------------------------------------------------

interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}

export function Stepper({ label, value, min, max, step, format = String, onChange }: StepperProps) {
  const round = (v: number) => Math.round(v * 100) / 100;
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label}`}
          onPress={() => onChange(round(Math.max(min, value - step)))}
          disabled={value <= min}
          style={({ pressed }) => [styles.stepButton, pressed && styles.pressed, value <= min && styles.disabled]}
        >
          <Ionicons name="remove" size={20} color={colors.text} />
        </Pressable>
        <Text style={styles.stepValue}>{format(value)}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label}`}
          onPress={() => onChange(round(Math.min(max, value + step)))}
          disabled={value >= max}
          style={({ pressed }) => [styles.stepButton, pressed && styles.pressed, value >= max && styles.disabled]}
        >
          <Ionicons name="add" size={20} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

// --- Info row ---------------------------------------------------------------

export function InfoRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, valueColor ? { color: valueColor } : null]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  fill: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  fixedHeader: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  headerText: { flex: 1 },
  subtitle: { ...typography.caption, marginTop: 2 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  sectionTitle: { ...typography.label, textTransform: 'uppercase' },
  button: {
    minHeight: TOUCH_TARGET - 8,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  buttonLarge: { minHeight: TOUCH_TARGET + 8, paddingHorizontal: spacing.xl },
  buttonLabel: { fontSize: 16, fontWeight: '700' },
  buttonLabelLarge: { fontSize: 18 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.4 },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.background,
    borderRadius: radius.pill,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segment: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  segmentSelected: { backgroundColor: colors.primary },
  segmentLabel: { color: colors.textMuted, fontWeight: '700', fontSize: 15 },
  segmentLabelSelected: { color: colors.onPrimary },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, minHeight: 44 },
  rowLabel: { ...typography.body, color: colors.textMuted, flexShrink: 1 },
  rowValue: { ...typography.body, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: { ...typography.body, fontWeight: '700', minWidth: 56, textAlign: 'center' },
});
