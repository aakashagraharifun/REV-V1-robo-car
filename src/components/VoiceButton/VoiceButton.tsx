/** Microphone button whose look follows the voice state (idle/listening/processing/speaking/error). */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import type { VoiceState } from '@/types/voice';
import { colors, spacing } from '@/theme/theme';
import type { IconName } from '@/components/ui/primitives';

const LOOK: Record<VoiceState, { color: string; icon: IconName; label: string; a11y: string }> = {
  idle: { color: colors.primary, icon: 'mic', label: 'Tap to talk', a11y: 'Start talking to Robo' },
  listening: { color: colors.danger, icon: 'mic', label: 'Listening… tap when done', a11y: 'Stop listening' },
  processing: { color: colors.accent, icon: 'hourglass', label: 'Thinking… tap to cancel', a11y: 'Cancel' },
  speaking: { color: colors.success, icon: 'volume-high', label: 'Speaking… tap to stop', a11y: 'Stop speaking' },
  error: { color: colors.warning, icon: 'alert', label: 'Tap to try again', a11y: 'Try again' },
};

interface VoiceButtonProps {
  state: VoiceState;
  onPress: () => void;
  size?: number;
  showLabel?: boolean;
}

export function VoiceButton({ state, onPress, size = 88, showLabel = true }: VoiceButtonProps) {
  const look = LOOK[state];
  const pulse = useState(() => new Animated.Value(0))[0];

  useEffect(() => {
    pulse.setValue(0);
    if (state !== 'listening' && state !== 'speaking') return;
    const animation = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: state === 'listening' ? 1100 : 800, useNativeDriver: true }),
    );
    animation.start();
    return () => animation.stop();
  }, [state, pulse]);

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });

  return (
    <View style={styles.wrap}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ring,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              borderColor: look.color,
              opacity: ringOpacity,
              transform: [{ scale: ringScale }],
            },
          ]}
        />
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={look.a11y}
          accessibilityState={{ busy: state === 'processing' }}
          style={({ pressed }) => [
            styles.button,
            { width: size, height: size, borderRadius: size / 2, backgroundColor: look.color },
            pressed && styles.pressed,
          ]}
        >
          {state === 'processing' ? (
            <ActivityIndicator size="large" color={colors.onPrimary} />
          ) : (
            <Ionicons name={look.icon} size={size * 0.42} color={colors.onPrimary} />
          )}
        </Pressable>
      </View>
      {showLabel && <Text style={[styles.label, { color: look.color }]}>{look.label}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.sm },
  ring: { position: 'absolute', borderWidth: 4 },
  button: { alignItems: 'center', justifyContent: 'center', elevation: 6 },
  pressed: { transform: [{ scale: 0.95 }] },
  label: { fontSize: 14, fontWeight: '700' },
});
