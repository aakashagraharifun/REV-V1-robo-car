/**
 * Decides what the user wants and returns a validated, safe action.
 *
 *   text ──► local rules ──(match)──► validate ──► RoutedIntent
 *              │
 *              └─(no match)──► AI (JSON) ──► parse ──► explicit-movement gate ──► validate ──► RoutedIntent
 *
 * The AI can only *propose* an intent. It never reaches the car without
 * passing commandValidator, and it can only propose movement when the user's
 * own words explicitly ask for it.
 */
import { AI_CONFIG } from '@/config/aiConfig';
import { buildSystemPrompt } from '@/config/robotConfig';
import type { AIMessage, ChatMessage } from '@/types/ai';
import { aiService } from '@/services/ai/AIService';
import { AIError } from '@/services/ai/AIProvider';
import {
  parseRawIntent,
  sanitizeResponse,
  validateCarCommand,
  validateSound,
} from './commandValidator';
import type { IntentType, RoutedIntent } from './intentTypes';
import { mentionsMovement, parseLocalIntent } from './localIntentParser';

export interface RouteContext {
  /** Previous conversation, oldest first (errors are ignored). */
  history: ChatMessage[];
  /** Speed limit from Settings. */
  speedLimit: number;
  signal?: AbortSignal;
}

/** Converts chat history to the JSON shape the system prompt asks the model to use. */
function toAIHistory(history: ChatMessage[]): AIMessage[] {
  return history
    .filter((m) => m.kind !== 'error')
    .slice(-AI_CONFIG.HISTORY_LIMIT)
    .map((m): AIMessage => {
      if (m.author === 'user') return { role: 'user', content: m.text };
      const intent: IntentType = m.intent === 'AI_QUESTION' ? 'AI_QUESTION' : 'GENERAL_CONVERSATION';
      return { role: 'assistant', content: JSON.stringify({ intent, response: m.text }) };
    });
}

export async function routeUserInput(rawText: string, ctx: RouteContext): Promise<RoutedIntent> {
  const text = rawText.trim().slice(0, AI_CONFIG.MAX_INPUT_LENGTH);

  // 1. Offline rules — instant and deterministic.
  const local = parseLocalIntent(text);
  if (local?.intent === 'CAR_COMMAND') {
    const result = validateCarCommand(local, { source: 'voice', speedLimit: ctx.speedLimit });
    return result.ok
      ? { type: 'CAR_COMMAND', command: result.value, origin: 'rules' }
      : { type: 'REJECTED', intent: 'CAR_COMMAND', reason: result.error, origin: 'rules' };
  }
  if (local?.intent === 'SOUND_REQUEST') {
    return { type: 'SOUND_REQUEST', sound: local.sound, origin: 'rules' };
  }

  // 2. Ask the AI for a structured intent.
  const messages: AIMessage[] = [
    { role: 'system', content: buildSystemPrompt() },
    ...toAIHistory(ctx.history),
    { role: 'user', content: text },
  ];
  const response = await aiService.generateResponse(messages, { signal: ctx.signal });
  const parsed = parseRawIntent(response.text);

  // Model ignored the JSON format — treat its text as a plain reply.
  if (!parsed.ok) {
    const plain = sanitizeResponse(response.text);
    if (!plain || plain.startsWith('{')) throw new AIError('invalid_response', parsed.error);
    return { type: 'GENERAL_CONVERSATION', response: plain, origin: 'ai' };
  }

  const raw = parsed.value;
  switch (raw.intent) {
    case 'CAR_COMMAND': {
      const isStop = typeof raw.command === 'string' && raw.command.trim().toLowerCase() === 'stop';
      // Explicit-movement gate: the AI can't start the motors unless the user asked.
      if (!isStop && !mentionsMovement(text)) {
        return {
          type: 'REJECTED',
          intent: 'CAR_COMMAND',
          reason: 'I only drive when you clearly ask me to, like “go forward” or “turn left”.',
          origin: 'ai',
        };
      }
      const result = validateCarCommand(raw, { source: 'ai', speedLimit: ctx.speedLimit });
      return result.ok
        ? { type: 'CAR_COMMAND', command: result.value, origin: 'ai' }
        : { type: 'REJECTED', intent: 'CAR_COMMAND', reason: result.error, origin: 'ai' };
    }
    case 'SOUND_REQUEST': {
      const result = validateSound(raw.sound);
      return result.ok
        ? { type: 'SOUND_REQUEST', sound: result.value, origin: 'ai' }
        : { type: 'REJECTED', intent: 'SOUND_REQUEST', reason: result.error, origin: 'ai' };
    }
    case 'AI_QUESTION':
    case 'GENERAL_CONVERSATION': {
      const reply = sanitizeResponse(raw.response);
      if (!reply) throw new AIError('empty_response');
      return { type: raw.intent, response: reply, origin: 'ai' };
    }
  }
}
