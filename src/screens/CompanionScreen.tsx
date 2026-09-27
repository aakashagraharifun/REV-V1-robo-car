import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { ChatBubble } from '@/components/ChatBubble';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { RobotFace } from '@/components/RobotFace';
import { Screen } from '@/components/ui/primitives';
import { VoiceButton } from '@/components/VoiceButton';
import { AI_CONFIG } from '@/config/aiConfig';
import { ROBOT_NAME } from '@/config/robotConfig';
import { useVoiceAssistant } from '@/hooks/useVoiceAssistant';
import { useAppStore } from '@/store/appStore';
import type { ChatMessage } from '@/types/ai';
import type { VoiceState } from '@/types/voice';
import { colors, radius, spacing, typography } from '@/theme/theme';

const SUGGESTIONS = ['Why is the sky blue?', 'Tell me a joke', 'Make a cow sound', 'Go forward', 'Turn left slowly'];

function statusText(state: VoiceState, error: string | null, handsFree: boolean): string {
  if (state === 'error' && error) return error;
  if (handsFree && (state === 'idle' || state === 'listening')) return 'Hands-free: just talk to me…';
  return STATUS_TEXT[state];
}

const STATUS_TEXT: Record<VoiceState, string> = {
  idle: 'Ask me anything, or tell me where to drive',
  listening: 'Listening…',
  processing: 'Thinking…',
  speaking: 'Speaking…',
  error: 'Something went wrong',
};

export default function CompanionScreen() {
  const {
    conversation,
    voiceState,
    voiceError,
    partialTranscript,
    speechRecognitionAvailable,
    handsFree,
    micPress,
    sendText,
    clearConversation,
    setHandsFree,
  } = useVoiceAssistant();
  const oledState = useAppStore((s) => s.oledState);
  const voiceOnCar = useAppStore((s) => s.audioOutput === 'esp32' && s.carSpeakerAvailable);
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<ChatMessage>>(null);

  // Keep the newest message in view when the list grows or the keyboard shrinks it.
  const scrollToEnd = (animated = true) => listRef.current?.scrollToEnd({ animated });

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    sendText(text);
  };

  const status = statusText(voiceState, voiceError, handsFree);

  const clearButton =
    conversation.length > 0 ? (
      <Pressable
        onPress={clearConversation}
        accessibilityRole="button"
        accessibilityLabel="Clear conversation"
        style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.6 }]}
      >
        <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
      </Pressable>
    ) : (
      <ConnectionStatus />
    );

  return (
    <Screen title={ROBOT_NAME} subtitle={status} right={clearButton} scroll={false}>
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <FlatList
          ref={listRef}
          style={styles.flex}
          data={conversation}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ChatBubble message={item} />}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onContentSizeChange={() => scrollToEnd()}
          onLayout={() => scrollToEnd(false)}
          ListHeaderComponent={
            conversation.length > 0 ? (
              <View style={styles.miniFace}>
                <RobotFace state={oledState} width={160} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <RobotFace state={oledState} width={240} />
              <Text style={styles.emptyTitle}>Hi, I’m {ROBOT_NAME}! 👋</Text>
              <Text style={styles.emptyText}>
                Ask me a question, ask for a sound, or tell me where to drive. Try one of these:
              </Text>
              <View style={styles.chips}>
                {SUGGESTIONS.map((suggestion) => (
                  <Pressable
                    key={suggestion}
                    onPress={() => sendText(suggestion)}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={styles.chipText}>{suggestion}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          }
          ListFooterComponent={
            voiceState === 'listening' && partialTranscript ? (
              <View style={styles.partial}>
                <Text style={styles.partialText}>“{partialTranscript}”</Text>
              </View>
            ) : null
          }
        />

        <View style={styles.voiceBar}>
          <Pressable
            onPress={() => setHandsFree(!handsFree)}
            disabled={!speechRecognitionAvailable}
            accessibilityRole="switch"
            accessibilityLabel="Hands-free voice control"
            accessibilityHint="Robo keeps listening and answers out loud until you say stop listening"
            accessibilityState={{ checked: handsFree, disabled: !speechRecognitionAvailable }}
            style={({ pressed }) => [
              styles.pill,
              handsFree && styles.pillOn,
              !speechRecognitionAvailable && styles.pillDisabled,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Ionicons name={handsFree ? 'radio' : 'radio-outline'} size={18} color={handsFree ? colors.onPrimary : colors.text} />
            <Text style={[styles.pillText, handsFree && styles.pillTextOn]}>{handsFree ? 'Hands-free ON' : 'Hands-free'}</Text>
          </Pressable>
          <View style={styles.outputChip} accessibilityLabel={voiceOnCar ? 'Voice plays on the car speaker' : 'Voice plays on the phone'}>
            <Ionicons name={voiceOnCar ? 'car-sport' : 'phone-portrait-outline'} size={16} color={colors.textMuted} />
            <Text style={styles.outputText}>{voiceOnCar ? 'Car speaker' : 'Phone speaker'}</Text>
          </View>
        </View>
        {handsFree ? (
          <Text style={styles.handsFreeHint}>I keep listening and answer out loud. Say “stop listening” or tap the mic to end.</Text>
        ) : !speechRecognitionAvailable ? (
          <Text style={styles.handsFreeHint}>Voice control needs the installed APK (it doesn’t work in Expo Go).</Text>
        ) : null}

        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={speechRecognitionAvailable ? `Type or tap the mic…` : `Message ${ROBOT_NAME}…`}
            placeholderTextColor={colors.textDim}
            cursorColor={colors.primary}
            selectionColor={colors.primary}
            textAlignVertical="center"
            onFocus={() => setTimeout(() => scrollToEnd(), 250)}
            maxLength={AI_CONFIG.MAX_INPUT_LENGTH}
            multiline
            returnKeyType="send"
            submitBehavior="submit"
            onSubmitEditing={submit}
            accessibilityLabel="Message"
          />
          {draft.trim().length > 0 ? (
            <Pressable
              onPress={submit}
              accessibilityRole="button"
              accessibilityLabel="Send message"
              style={({ pressed }) => [styles.send, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="arrow-up" size={24} color={colors.onPrimary} />
            </Pressable>
          ) : (
            <VoiceButton state={voiceState} onPress={micPress} size={48} showLabel={false} />
          )}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, flexGrow: 1 },
  miniFace: { alignItems: 'center', paddingVertical: spacing.sm },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  emptyTitle: { ...typography.title, fontSize: 24 },
  emptyText: { ...typography.body, color: colors.textMuted, textAlign: 'center', maxWidth: 320 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.sm },
  chip: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
    justifyContent: 'center',
  },
  chipText: { color: colors.text, fontWeight: '600' },
  partial: { alignSelf: 'flex-end', padding: spacing.md, maxWidth: '80%' },
  partialText: { color: colors.textMuted, fontStyle: 'italic', fontSize: 16 },
  voiceBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  pillOn: { backgroundColor: colors.success, borderColor: colors.success },
  pillDisabled: { opacity: 0.45 },
  pillText: { color: colors.text, fontWeight: '700' },
  pillTextOn: { color: colors.onPrimary },
  outputChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  outputText: { ...typography.caption },
  handsFreeHint: { ...typography.caption, paddingHorizontal: spacing.lg, paddingTop: spacing.xs, lineHeight: 17 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    backgroundColor: colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: spacing.lg,
    paddingTop: 12,
    paddingBottom: 12,
  },
  send: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
});
