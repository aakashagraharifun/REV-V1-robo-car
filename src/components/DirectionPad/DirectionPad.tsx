/**
 * Hold-to-drive D-pad with a large emergency STOP in the middle.
 * Press and hold an arrow to move; lift your finger (or slide off) to stop.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { MovementCommand } from '@/types/commands';
import { colors, spacing } from '@/theme/theme';
import type { IconName } from '@/components/ui/primitives';

type Direction = Exclude<MovementCommand, 'stop'>;

const ARROWS: Record<Direction, { icon: IconName; label: string }> = {
  forward: { icon: 'chevron-up', label: 'Forward' },
  backward: { icon: 'chevron-down', label: 'Backward' },
  left: { icon: 'chevron-back', label: 'Left' },
  right: { icon: 'chevron-forward', label: 'Right' },
};

interface DirectionPadProps {
  onPress: (direction: Direction) => void;
  onRelease: () => void;
  onStop: () => void;
  /** Direction currently being driven (highlights the arrow). */
  activeDirection: MovementCommand | null;
  size?: number;
}

export function DirectionPad({ onPress, onRelease, onStop, activeDirection, size = 300 }: DirectionPadProps) {
  const held = useRef<Direction | null>(null);
  const [pressed, setPressed] = useState<Direction | null>(null);
  const button = Math.round(size * 0.28);
  const stop = Math.round(size * 0.36);

  const handleIn = (direction: Direction) => {
    held.current = direction;
    setPressed(direction);
    onPress(direction);
  };

  const handleOut = (direction: Direction) => {
    // With two fingers down, only releasing the active arrow stops the car.
    if (held.current !== direction) return;
    held.current = null;
    setPressed(null);
    onRelease();
  };

  const arrow = (direction: Direction) => {
    const active = pressed === direction || activeDirection === direction;
    return (
      <Pressable
        key={direction}
        onPressIn={() => handleIn(direction)}
        onPressOut={() => handleOut(direction)}
        accessibilityRole="button"
        accessibilityLabel={`Drive ${ARROWS[direction].label}`}
        accessibilityHint="Hold to drive, release to stop"
        style={[
          styles.arrow,
          { width: button, height: button, borderRadius: button * 0.32 },
          active && styles.arrowActive,
        ]}
      >
        <Ionicons name={ARROWS[direction].icon} size={button * 0.5} color={active ? colors.onPrimary : colors.text} />
      </Pressable>
    );
  };

  return (
    <View style={[styles.pad, { width: size, height: size }]}>
      <View style={styles.row}>{arrow('forward')}</View>
      <View style={[styles.row, styles.middle]}>
        {arrow('left')}
        <Pressable
          onPress={onStop}
          accessibilityRole="button"
          accessibilityLabel="Emergency stop"
          style={({ pressed: isPressed }) => [
            styles.stop,
            { width: stop, height: stop, borderRadius: stop / 2 },
            isPressed && styles.stopPressed,
          ]}
        >
          <Ionicons name="hand-left" size={stop * 0.28} color="#FFFFFF" />
          <Text style={styles.stopLabel}>STOP</Text>
        </Pressable>
        {arrow('right')}
      </View>
      <View style={styles.row}>{arrow('backward')}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { alignSelf: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', justifyContent: 'center' },
  middle: { justifyContent: 'space-between', alignItems: 'center' },
  arrow: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  stop: {
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: colors.dangerDim,
    gap: spacing.xs,
    elevation: 8,
  },
  stopPressed: { transform: [{ scale: 0.94 }], opacity: 0.85 },
  stopLabel: { color: '#FFFFFF', fontWeight: '900', fontSize: 20, letterSpacing: 1.5 },
});
