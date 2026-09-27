import type { SoundId } from '@/types/audio';
import type { CarCommand, MovementCommand } from '@/types/commands';

export const INTENT_TYPES = ['CAR_COMMAND', 'AI_QUESTION', 'SOUND_REQUEST', 'GENERAL_CONVERSATION'] as const;
export type IntentType = (typeof INTENT_TYPES)[number];

/**
 * Structured intent as the AI (or the local rule parser) proposes it.
 * Fields are still untrusted — commandValidator turns these into safe actions.
 */
export type AIIntent =
  | { intent: 'CAR_COMMAND'; command: MovementCommand; speed?: number; duration?: number }
  | { intent: 'SOUND_REQUEST'; sound: SoundId }
  | { intent: 'AI_QUESTION'; response: string }
  | { intent: 'GENERAL_CONVERSATION'; response: string };

/** Loosely-typed intent straight out of JSON.parse, before validation. */
export interface RawIntent {
  intent: IntentType;
  command?: unknown;
  speed?: unknown;
  duration?: unknown;
  sound?: unknown;
  response?: unknown;
}

/** Who decided the intent: the offline rule parser or the AI model. */
export type IntentOrigin = 'rules' | 'ai';

/** Final, validated routing decision the assistant acts on. */
export type RoutedIntent =
  | { type: 'CAR_COMMAND'; command: CarCommand; origin: IntentOrigin }
  | { type: 'SOUND_REQUEST'; sound: SoundId; origin: IntentOrigin }
  | { type: 'AI_QUESTION' | 'GENERAL_CONVERSATION'; response: string; origin: IntentOrigin }
  /** A command was recognised but failed validation — nothing is executed. */
  | { type: 'REJECTED'; intent: IntentType; reason: string; origin: IntentOrigin };
