/** App-wide toast for short success/error messages (driven by store.notice). */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppStore } from '@/store/appStore';
import { colors, radius, spacing } from '@/theme/theme';

const VISIBLE_MS = 3_500;

export function NoticeToast() {
  const notice = useAppStore((s) => s.notice);
  const dismiss = useAppStore((s) => s.dismissNotice);
  const insets = useSafeAreaInsets();
  const opacity = useState(() => new Animated.Value(0))[0];

  useEffect(() => {
    if (!notice) return;
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    const timer = setTimeout(dismiss, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [notice, dismiss, opacity]);

  if (!notice) return null;

  const tone =
    notice.tone === 'error'
      ? { color: colors.danger, icon: 'alert-circle' as const }
      : notice.tone === 'success'
        ? { color: colors.success, icon: 'checkmark-circle' as const }
        : { color: colors.primary, icon: 'information-circle' as const };

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { top: insets.top + spacing.sm, opacity }]}
      accessibilityLiveRegion="polite"
    >
      <Pressable
        onPress={dismiss}
        accessibilityRole="alert"
        accessibilityHint="Tap to dismiss"
        style={[styles.toast, { borderColor: tone.color }]}
      >
        <Ionicons name={tone.icon} size={22} color={tone.color} />
        <Text style={styles.text}>{notice.message}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: spacing.lg, right: spacing.lg, zIndex: 100 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    elevation: 6,
  },
  text: { color: colors.text, fontSize: 15, flex: 1, fontWeight: '600' },
});
