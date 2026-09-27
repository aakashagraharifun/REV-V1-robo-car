/**
 * Speed slider (drag or tap) with −/+ buttons. The area above the safety
 * limit is shaded and unreachable.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';

import { colors, radius, spacing, typography } from '@/theme/theme';

interface SpeedControlProps {
  value: number;
  limit: number;
  onChange: (value: number) => void;
  step?: number;
}

const THUMB = 28;

export function SpeedControl({ value, limit, onChange, step = 10 }: SpeedControlProps) {
  const [trackWidth, setTrackWidth] = useState(0);

  const setFromX = (x: number) => {
    if (trackWidth <= 0) return;
    const pct = Math.round((Math.max(0, Math.min(trackWidth, x)) / trackWidth) * 100);
    onChange(Math.min(pct, limit));
  };

  const onLayout = (event: LayoutChangeEvent) => setTrackWidth(event.nativeEvent.layout.width);

  // Gesture responder props: tap or drag anywhere on the track.
  const gesture = {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (event: GestureResponderEvent) => setFromX(event.nativeEvent.locationX),
    onResponderMove: (event: GestureResponderEvent) => setFromX(event.nativeEvent.locationX),
  };

  const fill = (value / 100) * trackWidth;
  const limitX = (limit / 100) * trackWidth;

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.label}>SPEED</Text>
        <Text style={styles.value} accessibilityLiveRegion="polite">
          {value}%
        </Text>
      </View>
      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Slower"
          onPress={() => onChange(Math.max(0, value - step))}
          style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
        >
          <Ionicons name="remove" size={24} color={colors.text} />
        </Pressable>

        <View
          style={styles.trackArea}
          onLayout={onLayout}
          {...gesture}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Speed"
          accessibilityValue={{ min: 0, max: limit, now: value, text: `${value} percent` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'increment') onChange(Math.min(limit, value + step));
            if (event.nativeEvent.actionName === 'decrement') onChange(Math.max(0, value - step));
          }}
        >
          <View style={styles.track} pointerEvents="none">
            <View style={[styles.fill, { width: fill }]} />
            {limit < 100 && <View style={[styles.locked, { left: limitX }]} />}
          </View>
          <View
            pointerEvents="none"
            style={[styles.thumb, { left: Math.max(0, Math.min(trackWidth - THUMB, fill - THUMB / 2)) }]}
          />
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Faster"
          onPress={() => onChange(Math.min(limit, value + step))}
          style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
        >
          <Ionicons name="add" size={24} color={colors.text} />
        </Pressable>
      </View>
      <Text style={styles.hint}>Safety limit: {limit}% (change in Settings)</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  label: typography.label,
  value: { color: colors.primary, fontSize: 28, fontWeight: '800' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  trackArea: { flex: 1, height: 48, justifyContent: 'center' },
  track: { height: 12, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.primary },
  locked: { position: 'absolute', right: 0, top: 0, bottom: 0, backgroundColor: colors.dangerDim },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.text,
    borderWidth: 4,
    borderColor: colors.primary,
  },
  stepButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  hint: typography.caption,
});
