import Ionicons from '@expo/vector-icons/Ionicons';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ROBOT_NAME } from '@/config/robotConfig';
import type { ChatMessage } from '@/types/ai';
import { colors, radius, spacing } from '@/theme/theme';

const INTENT_LABELS: Record<NonNullable<ChatMessage['intent']>, string> = {
  CAR_COMMAND: 'Car command',
  AI_QUESTION: 'Question',
  SOUND_REQUEST: 'Sound',
  GENERAL_CONVERSATION: 'Chat',
};

function ChatBubbleBase({ message }: { message: ChatMessage }) {
  const isUser = message.author === 'user';
  const isError = message.kind === 'error';
  const isAction = message.kind === 'action';

  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowRobo]}>
      {!isUser && (
        <View style={[styles.avatar, isError && { backgroundColor: colors.dangerDim }]}>
          <Ionicons name={isError ? 'alert' : isAction ? 'flash' : 'happy'} size={18} color={colors.text} />
        </View>
      )}
      <View
        style={[
          styles.bubble,
          isUser ? styles.bubbleUser : styles.bubbleRobo,
          isAction && styles.bubbleAction,
          isError && styles.bubbleError,
        ]}
        accessibilityLabel={`${isUser ? 'You' : ROBOT_NAME}: ${message.text}`}
      >
        {!isUser && message.intent && !isError && <Text style={styles.intent}>{INTENT_LABELS[message.intent]}</Text>}
        <Text style={[styles.text, isUser && styles.textUser]}>{message.text}</Text>
      </View>
    </View>
  );
}

export const ChatBubble = memo(ChatBubbleBase);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginVertical: spacing.xs },
  rowUser: { justifyContent: 'flex-end' },
  rowRobo: { justifyContent: 'flex-start' },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubble: { maxWidth: '80%', paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderRadius: radius.lg, gap: 4 },
  bubbleUser: { backgroundColor: colors.primary, borderBottomRightRadius: 6 },
  bubbleRobo: { backgroundColor: colors.surfaceRaised, borderBottomLeftRadius: 6 },
  bubbleAction: { borderWidth: 1, borderColor: colors.success },
  bubbleError: { backgroundColor: colors.dangerDim },
  intent: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  text: { color: colors.text, fontSize: 16, lineHeight: 22 },
  textUser: { color: colors.onPrimary, fontWeight: '600' },
});
