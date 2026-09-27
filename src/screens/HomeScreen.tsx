import { router } from 'expo-router';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { ConnectionStatus, DemoModeBanner } from '@/components/ConnectionStatus';
import { RobotFace } from '@/components/RobotFace';
import { AppButton, Card, InfoRow, Screen } from '@/components/ui/primitives';
import { ROBOT_NAME } from '@/config/robotConfig';
import { useAppStore } from '@/store/appStore';
import { useVoiceAssistant } from '@/hooks/useVoiceAssistant';
import type { OLEDState } from '@/types/oled';
import { colors, spacing, typography } from '@/theme/theme';
import { describeCarStatus, describeConnection } from '@/utils/format';

const MOOD_TEXT: Record<OLEDState, string> = {
  idle: 'Hi! Ready when you are.',
  listening: 'I’m listening…',
  thinking: 'Hmm, let me think…',
  speaking: 'Talking…',
  moving: 'Wheee! On the move!',
  stopped: 'Stopped.',
  error: 'Oops, something went wrong.',
};

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const oledState = useAppStore((s) => s.oledState);
  const carStatus = useAppStore((s) => s.carStatus);
  const connectionState = useAppStore((s) => s.connectionState);
  const speed = useAppStore((s) => s.speed);
  const voiceError = useAppStore((s) => s.voiceError);
  const { talk, voiceState, handsFree, setHandsFree, speechRecognitionAvailable } = useVoiceAssistant();

  const faceWidth = Math.min(width - spacing.lg * 2, 420);

  const onTalk = () => {
    router.navigate('/companion');
    talk();
  };

  const onHandsFree = () => {
    if (!handsFree) router.navigate('/companion');
    setHandsFree(!handsFree);
  };

  return (
    <Screen title={ROBOT_NAME} subtitle="Your robot car companion" right={<ConnectionStatus />}>
      <DemoModeBanner />

      <View style={styles.faceArea}>
        <RobotFace state={oledState} width={faceWidth} />
        <Text style={styles.mood} accessibilityLiveRegion="polite">
          {oledState === 'error' && voiceError ? voiceError : MOOD_TEXT[oledState]}
        </Text>
      </View>

      <View style={styles.actions}>
        <AppButton
          label={voiceState === 'listening' ? 'Listening…' : `Talk to ${ROBOT_NAME}`}
          icon="mic"
          large
          onPress={onTalk}
          accessibilityHint="Opens the chat and starts listening"
        />
        <AppButton
          label={handsFree ? 'Stop hands-free' : 'Hands-free voice control'}
          icon="radio"
          variant={handsFree ? 'danger' : 'secondary'}
          large
          disabled={!speechRecognitionAvailable}
          onPress={onHandsFree}
          accessibilityHint="Robo keeps listening and answering out loud until you say stop listening"
        />
        <AppButton label="Drive" icon="game-controller" variant="secondary" large onPress={() => router.navigate('/control')} />
      </View>

      <Card>
        <InfoRow
          label="Bluetooth"
          value={describeConnection(connectionState)}
          valueColor={connectionState === 'connected' ? colors.success : colors.accent}
        />
        <InfoRow label="Status" value={describeCarStatus(carStatus)} />
        <InfoRow label="Speed" value={`${carStatus.state === 'moving' ? carStatus.speed : speed}%`} />
        <InfoRow label="Battery" value={carStatus.battery === null ? '—' : `${carStatus.battery}%`} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  faceArea: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  mood: { ...typography.heading, textAlign: 'center' },
  actions: { gap: spacing.md },
});
