import { useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { AppButton, Card, Screen } from '@/components/ui/primitives';
import { audioService, AudioError } from '@/services/audio/audioService';
import { SOUND_LIBRARY } from '@/services/audio/soundLibrary';
import { useAppStore } from '@/store/appStore';
import { SOUND_IDS, type SoundId } from '@/types/audio';
import { colors, radius, spacing, typography } from '@/theme/theme';

export default function SoundsScreen() {
  const { width } = useWindowDimensions();
  const [playing, setPlaying] = useState<SoundId | null>(null);
  const onCar = useAppStore((s) => s.audioOutput === 'esp32' && s.carSpeakerAvailable);
  const columns = width > 600 ? 4 : 3;
  const tileSize = (Math.min(width, 720) - spacing.lg * 2 - spacing.md * (columns - 1)) / columns;

  const play = async (id: SoundId) => {
    // Tapping a new sound replaces whatever is playing.
    audioService.stopAll();
    setPlaying(id);
    try {
      await audioService.playSound(id);
    } catch (error) {
      const message = error instanceof AudioError ? error.userMessage : 'I couldn’t play that sound.';
      useAppStore.getState().showNotice(message, 'error');
    } finally {
      setPlaying((current) => (current === id ? null : current));
    }
  };

  const stop = () => {
    audioService.stopAll();
    setPlaying(null);
  };

  return (
    <Screen title="Sounds" subtitle={`Tap a sound — it plays on the ${onCar ? 'car' : 'phone'} speaker`}>
      <View style={styles.grid}>
        {SOUND_IDS.map((id) => {
          const sound = SOUND_LIBRARY[id];
          const active = playing === id;
          return (
            <Pressable
              key={id}
              onPress={() => void play(id)}
              accessibilityRole="button"
              accessibilityLabel={`Play ${sound.label} sound`}
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [
                styles.tile,
                { width: tileSize, height: tileSize },
                active && styles.tileActive,
                pressed && styles.tilePressed,
              ]}
            >
              <Text style={styles.emoji}>{sound.emoji}</Text>
              <Text style={[styles.tileLabel, active && { color: colors.onPrimary }]}>{sound.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <AppButton label="Stop sound" icon="stop" variant="secondary" onPress={stop} disabled={playing === null} />

      <Card>
        <Text style={styles.noteTitle}>Tip</Text>
        <Text style={styles.note}>
          You can also ask in the Companion tab: “Make a cow sound” or “Can you roar like a lion?”
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  tileActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tilePressed: { transform: [{ scale: 0.95 }] },
  emoji: { fontSize: 40 },
  tileLabel: { ...typography.body, fontWeight: '700' },
  noteTitle: typography.label,
  note: { ...typography.body, color: colors.textMuted },
});
