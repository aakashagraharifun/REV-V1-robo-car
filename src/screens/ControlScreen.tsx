import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { ConnectionStatus, DemoModeBanner } from '@/components/ConnectionStatus';
import { DirectionPad } from '@/components/DirectionPad';
import { SpeedControl } from '@/components/SpeedControl';
import { Card, InfoRow, Screen } from '@/components/ui/primitives';
import { useCarControl } from '@/hooks/useCarControl';
import { useAppStore } from '@/store/appStore';
import { colors, spacing, typography } from '@/theme/theme';
import { describeCarStatus, describeConnection } from '@/utils/format';

export default function ControlScreen() {
  const { width } = useWindowDimensions();
  const connectionState = useAppStore((s) => s.connectionState);
  const { speed, speedLimit, currentCommand, carStatus, press, release, emergencyStop, setSpeed } = useCarControl();

  const padSize = Math.min(width - spacing.lg * 4, 320);
  const commandText = currentCommand
    ? `${currentCommand.command.toUpperCase()}${currentCommand.durationMs ? ` (${currentCommand.durationMs / 1000}s)` : ''}`
    : 'STOP';

  return (
    <Screen title="Car Control" subtitle="Hold an arrow to drive · release to stop" right={<ConnectionStatus />}>
      <DemoModeBanner />

      <Card style={styles.statusCard}>
        <View style={styles.statusItem}>
          <Text style={styles.statusLabel}>COMMAND</Text>
          <Text style={[styles.statusValue, currentCommand && { color: colors.primary }]}>{commandText}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.statusItem}>
          <Text style={styles.statusLabel}>CAR</Text>
          <Text style={styles.statusValue}>{describeCarStatus(carStatus)}</Text>
        </View>
      </Card>

      <DirectionPad
        size={padSize}
        activeDirection={currentCommand?.command ?? null}
        onPress={press}
        onRelease={release}
        onStop={emergencyStop}
      />

      <Card>
        <SpeedControl value={speed} limit={speedLimit} onChange={setSpeed} />
      </Card>

      <Card>
        <InfoRow
          label="Bluetooth"
          value={describeConnection(connectionState)}
          valueColor={connectionState === 'connected' ? colors.success : colors.accent}
        />
        <InfoRow label="Reported speed" value={`${carStatus.speed}%`} />
        <InfoRow label="Battery" value={carStatus.battery === null ? '—' : `${carStatus.battery}%`} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  statusCard: { flexDirection: 'row', alignItems: 'center' },
  statusItem: { flex: 1, alignItems: 'center', gap: 2 },
  statusLabel: typography.label,
  statusValue: { ...typography.heading, fontSize: 20 },
  divider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border },
});
