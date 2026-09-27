import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { RobotFace } from '@/components/RobotFace';
import {
  AppButton,
  Card,
  InfoRow,
  Screen,
  SectionTitle,
  SegmentedControl,
  Stepper,
} from '@/components/ui/primitives';
import { AI_ENV, AI_PROVIDER_LABELS } from '@/config/aiConfig';
import { BLE_CONFIG } from '@/config/bleConfig';
import { ROBOT_NAME } from '@/config/robotConfig';
import { SAFETY_CONFIG } from '@/config/safetyConfig';
import { useBluetooth } from '@/hooks/useBluetooth';
import { AIError } from '@/services/ai/AIProvider';
import { aiService } from '@/services/ai/AIService';
import { credentials } from '@/services/ai/credentials';
import { PROTOCOL_VERSION } from '@/services/bluetooth/bleProtocol';
import { oledService } from '@/services/oled/oledService';
import { voiceService } from '@/services/voice/voiceService';
import { speechSynthesizer } from '@/services/voice/speechSynthesizer';
import { refreshKeySources } from '@/store/bindings';
import { useAppStore } from '@/store/appStore';
import type { AIProviderId } from '@/types/ai';
import type { AudioOutputTarget } from '@/types/audio';
import type { BluetoothAdapterState, BluetoothDevice } from '@/types/bluetooth';
import { OLED_STATES, type OLEDState } from '@/types/oled';
import { colors, radius, spacing, typography } from '@/theme/theme';
import { describeConnection } from '@/utils/format';

const PROVIDER_OPTIONS = [
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'groq', label: 'Groq' },
] as const;

const LANGUAGE_OPTIONS = [
  { value: 'en-US', label: 'EN-US' },
  { value: 'en-GB', label: 'EN-GB' },
  { value: 'en-IN', label: 'EN-IN' },
  { value: 'hi-IN', label: 'HI-IN' },
] as const;

const OUTPUT_OPTIONS = [
  { value: 'esp32', label: 'Car speaker' },
  { value: 'phone', label: 'Phone' },
] as const;

const ADAPTER_WARNINGS: Partial<Record<BluetoothAdapterState, string>> = {
  unavailable:
    'Bluetooth needs the development build or APK (it isn’t available in Expo Go or on web). Demo Mode works everywhere.',
  unsupported: 'This phone doesn’t support Bluetooth Low Energy. Demo Mode still works.',
  unauthorized: 'Bluetooth permission is denied. Allow “Nearby devices” for this app in Android settings.',
  poweredOff: 'Bluetooth is off. Turn it on in the quick settings to find your car.',
};

// ---------------------------------------------------------------------------

function SwitchRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.switchRow}>
      <Text style={styles.switchLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ false: colors.surfaceRaised, true: colors.primaryDim }}
        thumbColor={value ? colors.primary : colors.textMuted}
      />
    </View>
  );
}

function BluetoothSection() {
  const bt = useBluetooth();
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const warning = ADAPTER_WARNINGS[bt.adapterState];

  const connect = async (device: BluetoothDevice) => {
    setConnectingId(device.id);
    await bt.connect(device);
    setConnectingId(null);
  };

  return (
    <Card>
      <SectionTitle>Bluetooth car</SectionTitle>
      <InfoRow
        label="Status"
        value={describeConnection(bt.connectionState)}
        valueColor={bt.connectionState === 'connected' ? colors.success : colors.accent}
      />
      {warning ? <Text style={styles.warning}>{warning}</Text> : null}

      {bt.connectionState === 'connected' && bt.connectedDevice ? (
        <>
          <InfoRow label="Device" value={bt.connectedDevice.name ?? bt.connectedDevice.id} />
          <AppButton label="Disconnect" icon="close-circle" variant="secondary" onPress={() => void bt.disconnect()} />
        </>
      ) : (
        <>
          <AppButton
            label={bt.isScanning ? 'Stop scanning' : 'Scan for cars'}
            icon={bt.isScanning ? 'stop' : 'search'}
            variant={bt.isScanning ? 'secondary' : 'primary'}
            disabled={!bt.isBluetoothAvailable || bt.connectionState === 'connecting'}
            onPress={() => (bt.isScanning ? bt.stopScan() : void bt.scan())}
          />
          {bt.isScanning && (
            <View style={styles.scanning}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.muted}>Looking for devices named “{BLE_CONFIG.DEVICE_NAME_PREFIXES.join('” or “')}”…</Text>
            </View>
          )}
          {bt.discoveredDevices.map((device) => (
            <Pressable
              key={device.id}
              onPress={() => void connect(device)}
              disabled={connectingId !== null}
              accessibilityRole="button"
              accessibilityLabel={`Connect to ${device.name ?? device.id}`}
              style={({ pressed }) => [styles.device, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="car-sport" size={22} color={colors.primary} />
              <View style={styles.deviceText}>
                <Text style={styles.deviceName}>{device.name ?? 'Unnamed device'}</Text>
                <Text style={styles.muted}>
                  {device.rssi !== null ? `Signal ${device.rssi} dBm` : device.id}
                </Text>
              </View>
              {connectingId === device.id ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={styles.link}>Connect</Text>
              )}
            </Pressable>
          ))}
        </>
      )}

      <SwitchRow label="Reconnect automatically" value={bt.autoReconnect} onChange={bt.setAutoReconnect} />
      <Text style={styles.muted}>
        When no car is connected, {ROBOT_NAME} uses Demo Mode: a simulated car that follows the same protocol, so every
        button can be tested without hardware.
      </Text>
    </Card>
  );
}

function AISection() {
  const provider = useAppStore((s) => s.aiProvider);
  const models = useAppStore((s) => s.aiModels);
  const keySources = useAppStore((s) => s.keySources);
  const set = useAppStore((s) => s.set);
  const [keyDraft, setKeyDraft] = useState('');
  const [testing, setTesting] = useState(false);

  const effectiveModel = models[provider] || AI_ENV[provider].model;
  const keySource = keySources[provider];
  const label = AI_PROVIDER_LABELS[provider];

  const setModel = (value: string) => set({ aiModels: { ...models, [provider]: value } });

  const saveKey = async () => {
    await credentials.setApiKey(provider, keyDraft);
    setKeyDraft('');
    refreshKeySources();
    useAppStore.getState().showNotice(`${label} key saved on this phone`, 'success');
  };

  const clearKey = async () => {
    await credentials.clearApiKey(provider);
    refreshKeySources();
    useAppStore.getState().showNotice(`${label} key removed`, 'info');
  };

  const test = async () => {
    setTesting(true);
    try {
      const result = await aiService.getProvider(provider).generateResponse(
        [{ role: 'user', content: 'Reply with exactly one word: ready' }],
        { maxTokens: 100 }, // room for "thinking" models to finish
      );
      useAppStore.getState().showNotice(`${label} works ✓ (${result.model})`, 'success');
    } catch (error) {
      const message = error instanceof AIError ? error.userMessage : 'The test failed.';
      useAppStore.getState().showNotice(message, 'error');
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <SectionTitle>AI brain</SectionTitle>
      <SegmentedControl<AIProviderId>
        options={PROVIDER_OPTIONS}
        value={provider}
        onChange={(value) => {
          setKeyDraft('');
          set({ aiProvider: value, aiProviderChosen: true });
        }}
      />

      <Text style={styles.fieldLabel}>Model</Text>
      <TextInput
        style={styles.input}
        value={models[provider]}
        onChangeText={setModel}
        placeholder={AI_ENV[provider].model || 'e.g. model id from the provider’s website'}
        placeholderTextColor={colors.textDim}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={`${label} model`}
      />
      <Text style={styles.muted}>
        {effectiveModel ? `Using: ${effectiveModel}` : 'No model set — enter one above or in .env.'}
      </Text>

      <Text style={styles.fieldLabel}>API key</Text>
      <TextInput
        style={styles.input}
        value={keyDraft}
        onChangeText={setKeyDraft}
        placeholder={keySource === 'none' ? 'Paste your key' : 'Key is set — paste to replace'}
        placeholderTextColor={colors.textDim}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        accessibilityLabel={`${label} API key`}
      />
      <Text style={styles.muted}>
        {keySource === 'settings'
          ? 'Key saved on this phone (encrypted storage).'
          : keySource === 'env'
            ? 'Key comes from the build’s .env (EXPO_PUBLIC_…).'
            : 'No key set.'}
      </Text>
      <View style={styles.buttonRow}>
        <AppButton label="Save key" icon="key" onPress={() => void saveKey()} disabled={!keyDraft.trim()} style={styles.flex} />
        {keySource === 'settings' && (
          <AppButton label="Remove" variant="secondary" onPress={() => void clearKey()} style={styles.flex} />
        )}
      </View>
      <AppButton label="Test connection" icon="pulse" variant="ghost" loading={testing} onPress={() => void test()} />

      <View style={styles.securityNote}>
        <Ionicons name="shield-checkmark" size={18} color={colors.warning} />
        <Text style={styles.securityText}>
          Prototype only: an API key inside a phone app can be extracted by anyone who has the app. Use a key with a low
          spending limit, and move to a small backend before sharing the app.
        </Text>
      </View>
    </Card>
  );
}

function carSpeakerStatus(output: AudioOutputTarget, connected: boolean, hasSpeaker: boolean): { text: string; ok: boolean } {
  if (output === 'phone') return { text: 'Robo talks through the phone speaker.', ok: true };
  if (!speechSynthesizer.isAvailable()) {
    return { text: 'The car speaker needs the installed APK. Using the phone for now.', ok: false };
  }
  if (!connected) return { text: 'No car connected — using the phone until you connect.', ok: false };
  if (!hasSpeaker) {
    return { text: 'This car’s firmware has no speaker (audio characteristic). Flash firmware/robo_car. Using the phone.', ok: false };
  }
  return { text: 'Robo’s voice and sounds play on the car.', ok: true };
}

function VoiceSection() {
  const voiceSettings = useAppStore((s) => s.voiceSettings);
  const sttAvailable = useAppStore((s) => s.speechRecognitionAvailable);
  const audioOutput = useAppStore((s) => s.audioOutput);
  const connected = useAppStore((s) => s.connectionState === 'connected');
  const hasSpeaker = useAppStore((s) => s.carSpeakerAvailable);
  const set = useAppStore((s) => s.set);
  const update = (patch: Partial<typeof voiceSettings>) => set({ voiceSettings: { ...voiceSettings, ...patch } });
  const speaker = carSpeakerStatus(audioOutput, connected, hasSpeaker);

  return (
    <Card>
      <SectionTitle>Voice</SectionTitle>
      <InfoRow
        label="Speech recognition"
        value={sttAvailable ? 'Available' : 'Not available'}
        valueColor={sttAvailable ? colors.success : colors.warning}
      />
      {!sttAvailable && (
        <Text style={styles.warning}>
          Voice input needs the development build/APK and Google speech services on the phone. Typing always works.
        </Text>
      )}
      <SwitchRow label="Speak replies out loud" value={voiceSettings.autoSpeak} onChange={(autoSpeak) => update({ autoSpeak })} />
      <Text style={styles.fieldLabel}>Robo’s voice comes from</Text>
      <SegmentedControl<AudioOutputTarget>
        options={OUTPUT_OPTIONS}
        value={audioOutput}
        onChange={(value) => set({ audioOutput: value })}
      />
      <Text style={speaker.ok ? styles.muted : styles.warning}>{speaker.text}</Text>
      <Text style={styles.fieldLabel}>Language</Text>
      <SegmentedControl options={LANGUAGE_OPTIONS} value={voiceSettings.language as (typeof LANGUAGE_OPTIONS)[number]['value']} onChange={(language) => update({ language })} />
      <Stepper label="Speed" value={voiceSettings.rate} min={0.5} max={2} step={0.1} format={(v) => `${v.toFixed(1)}×`} onChange={(rate) => update({ rate })} />
      <Stepper label="Pitch" value={voiceSettings.pitch} min={0.5} max={2} step={0.1} format={(v) => v.toFixed(1)} onChange={(pitch) => update({ pitch })} />
      <AppButton
        label="Test voice"
        icon="volume-high"
        variant="secondary"
        onPress={() => void voiceService.speak(`Hi! I'm ${ROBOT_NAME}. Nice to meet you!`)}
      />
    </Card>
  );
}

function SafetySection() {
  const speedLimit = useAppStore((s) => s.speedLimit);
  const speed = useAppStore((s) => s.speed);
  const set = useAppStore((s) => s.set);
  return (
    <Card>
      <SectionTitle>Safety</SectionTitle>
      <Stepper
        label="Max speed"
        value={speedLimit}
        min={10}
        max={SAFETY_CONFIG.HARD_MAX_SPEED}
        step={10}
        format={(v) => `${v}%`}
        onChange={(limit) => set({ speedLimit: limit, speed: Math.min(speed, limit) })}
      />
      <Text style={styles.muted}>
        Voice and AI moves last at most {SAFETY_CONFIG.MAX_COMMAND_DURATION_MS / 1000}s. The car stops if the app loses
        the connection, goes to the background, or stops sending keep-alives for {SAFETY_CONFIG.FIRMWARE_WATCHDOG_MS / 1000}s.
      </Text>
    </Card>
  );
}

function OledSection() {
  const oledState = useAppStore((s) => s.oledState);
  const override = useAppStore((s) => s.oledOverride);
  const set = useAppStore((s) => s.set);

  const choose = (state: OLEDState | null) => {
    set({ oledOverride: state });
    oledService.setOverride(state);
  };

  const chip = (label: string, value: OLEDState | null) => {
    const selected = override === value;
    return (
      <Pressable
        key={label}
        onPress={() => choose(value)}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        style={[styles.chip, selected && styles.chipSelected]}
      >
        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <Card>
      <SectionTitle>OLED face preview</SectionTitle>
      <RobotFace state={oledState} width={260} />
      <Text style={styles.muted}>
        Pick a face to test it. When a car is connected, the state is also sent to its OLED. “Auto” follows what{' '}
        {ROBOT_NAME} is doing.
      </Text>
      <View style={styles.chips}>
        {chip('Auto', null)}
        {OLED_STATES.map((state) => chip(state.toUpperCase(), state))}
      </View>
    </Card>
  );
}

function AboutSection() {
  return (
    <Card>
      <SectionTitle>About</SectionTitle>
      <InfoRow label="App" value={`${Constants.expoConfig?.name ?? 'Robo Car'} ${Constants.expoConfig?.version ?? ''}`} />
      <InfoRow label="Robot name" value={ROBOT_NAME} />
      <InfoRow label="ESP32 protocol" value={`v${PROTOCOL_VERSION} · JSON over BLE`} />
      <Text style={styles.muted}>
        The phone is the brain (AI, voice, app). The ESP32 drives the motors, shows the OLED face and plays Robo’s voice on its speaker. See README.md and
        docs/ESP32_PROTOCOL.md in the project.
      </Text>
    </Card>
  );
}

export default function SettingsScreen() {
  return (
    <Screen title="Settings">
      <BluetoothSection />
      <AISection />
      <VoiceSection />
      <SafetySection />
      <OledSection />
      <AboutSection />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  muted: { ...typography.caption, lineHeight: 18 },
  warning: { color: colors.warning, fontSize: 14, lineHeight: 20 },
  fieldLabel: { ...typography.label, marginTop: spacing.xs },
  input: {
    minHeight: 48,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: spacing.md,
  },
  buttonRow: { flexDirection: 'row', gap: spacing.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  switchLabel: { ...typography.body, flex: 1 },
  scanning: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  device: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    minHeight: 56,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  deviceText: { flex: 1 },
  deviceName: { ...typography.body, fontWeight: '700' },
  link: { color: colors.primary, fontWeight: '800' },
  securityNote: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: '#2A2410',
  },
  securityText: { color: colors.text, fontSize: 13, lineHeight: 19, flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontWeight: '700', fontSize: 13 },
  chipTextSelected: { color: colors.onPrimary },
});
