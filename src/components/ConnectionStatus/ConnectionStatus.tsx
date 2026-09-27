import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { BluetoothAdapterState, ConnectionState } from '@/types/bluetooth';
import { useAppStore } from '@/store/appStore';
import { colors, radius, spacing } from '@/theme/theme';

function describe(connection: ConnectionState, adapter: BluetoothAdapterState, name: string | null) {
  if (connection === 'connected') return { text: name ?? 'Connected', color: colors.success, icon: 'bluetooth' as const };
  if (connection === 'connecting') return { text: 'Connecting…', color: colors.warning, icon: 'bluetooth' as const };
  if (connection === 'reconnecting') return { text: 'Reconnecting…', color: colors.warning, icon: 'bluetooth' as const };
  if (adapter === 'poweredOff') return { text: 'Bluetooth off', color: colors.danger, icon: 'bluetooth' as const };
  return { text: 'Demo Mode', color: colors.accent, icon: 'game-controller' as const };
}

/** Compact status pill; tap to open Bluetooth settings. */
export function ConnectionStatus() {
  const connectionState = useAppStore((s) => s.connectionState);
  const adapterState = useAppStore((s) => s.adapterState);
  const deviceName = useAppStore((s) => s.connectedDevice?.name ?? null);
  const look = describe(connectionState, adapterState, deviceName);

  return (
    <Pressable
      onPress={() => router.navigate('/settings')}
      accessibilityRole="button"
      accessibilityLabel={`Bluetooth: ${look.text}. Open settings`}
      style={({ pressed }) => [styles.pill, { borderColor: look.color }, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.dot, { backgroundColor: look.color }]} />
      <Ionicons name={look.icon} size={14} color={look.color} />
      <Text style={[styles.text, { color: look.color }]} numberOfLines={1}>
        {look.text}
      </Text>
    </Pressable>
  );
}

/** Banner shown whenever commands go to the simulated car. */
export function DemoModeBanner() {
  const connectionState = useAppStore((s) => s.connectionState);
  if (connectionState === 'connected') return null;
  return (
    <Pressable
      onPress={() => router.navigate('/settings')}
      accessibilityRole="button"
      accessibilityLabel="Demo Mode, ESP32 not connected. Open settings to connect."
      style={({ pressed }) => [styles.banner, pressed && { opacity: 0.8 }]}
    >
      <Ionicons name="flask" size={18} color={colors.accent} />
      <Text style={styles.bannerText}>Demo Mode — ESP32 not connected</Text>
      <Text style={styles.bannerLink}>Connect</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    minHeight: 36,
    maxWidth: 180,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { fontWeight: '700', fontSize: 13, flexShrink: 1 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#1E1A3D',
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 44,
  },
  bannerText: { color: colors.text, fontWeight: '600', flex: 1, fontSize: 14 },
  bannerLink: { color: colors.accent, fontWeight: '800', fontSize: 14 },
});
