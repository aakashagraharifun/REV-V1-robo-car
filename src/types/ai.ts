import type { IntentType } from '@/services/intent/intentTypes';

export type AIProviderId = 'openrouter' | 'groq';

export type AIRole = 'system' | 'user' | 'assistant';

/** A message in the format every provider accepts. */
export interface AIMessage {
  role: AIRole;
  content: string;
}

export interface GenerateOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface AIResponse {
  text: string;
  provider: AIProviderId;
  model: string;
}

export type AIErrorCode =
  | 'missing_api_key'
  | 'missing_model'
  | 'invalid_api_key'
  | 'rate_limited'
  | 'insufficient_credits'
  | 'content_blocked'
  | 'model_unavailable'
  | 'network'
  | 'timeout'
  | 'invalid_response'
  | 'empty_response'
  | 'server_error'
  | 'aborted'
  | 'unknown';

/** A message shown in the Companion conversation. */
export interface ChatMessage {
  id: string;
  author: 'user' | 'robo';
  text: string;
  createdAt: number;
  /** How the user's request was classified (set on Robo's reply). */
  intent?: IntentType;
  /** `action` = Robo did something (drove, played a sound); `error` = something failed. */
  kind: 'text' | 'action' | 'error';
}

export type { IntentType, AIIntent } from '@/services/intent/intentTypes';
