import type { AIProviderId } from '@/types/ai';

/**
 * AI configuration.
 *
 * Values come from EXPO_PUBLIC_* environment variables (see .env.example) and
 * can be overridden at runtime from the Settings screen.
 *
 * ⚠️ SECURITY: anything prefixed EXPO_PUBLIC_ is inlined into the JavaScript
 * bundle in plain text. A mobile app cannot keep a permanent API key secret —
 * anyone with the APK can extract it. This is acceptable ONLY for local
 * development and personal prototypes. For anything shared, put a small
 * backend in front of OpenRouter/Groq and point *_BASE_URL at it (see README,
 * "Moving to a backend").
 *
 * Note: Expo only inlines variables referenced as `process.env.EXPO_PUBLIC_X`
 * (dot notation). Don't refactor these into dynamic lookups.
 */

function readEnv(value: string | undefined): string {
  return (value ?? '').trim();
}

function parseProvider(value: string): AIProviderId {
  return value === 'groq' ? 'groq' : 'openrouter';
}

export interface ProviderEnvConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

export const AI_ENV = {
  provider: parseProvider(readEnv(process.env.EXPO_PUBLIC_AI_PROVIDER)),
  openrouter: {
    apiKey: readEnv(process.env.EXPO_PUBLIC_OPENROUTER_API_KEY),
    model: readEnv(process.env.EXPO_PUBLIC_OPENROUTER_MODEL),
    baseUrl: readEnv(process.env.EXPO_PUBLIC_OPENROUTER_BASE_URL) || 'https://openrouter.ai/api/v1',
  } satisfies ProviderEnvConfig,
  groq: {
    apiKey: readEnv(process.env.EXPO_PUBLIC_GROQ_API_KEY),
    model: readEnv(process.env.EXPO_PUBLIC_GROQ_MODEL),
    baseUrl: readEnv(process.env.EXPO_PUBLIC_GROQ_BASE_URL) || 'https://api.groq.com/openai/v1',
  } satisfies ProviderEnvConfig,
} as const;

export const AI_CONFIG = {
  REQUEST_TIMEOUT_MS: 20_000,
  TEMPERATURE: 0.6,
  MAX_TOKENS: 300,
  /** Number of previous chat messages sent to the model as context. */
  HISTORY_LIMIT: 10,
  /** Longest user message accepted (characters). */
  MAX_INPUT_LENGTH: 500,
} as const;

export const AI_PROVIDER_LABELS: Record<AIProviderId, string> = {
  openrouter: 'OpenRouter',
  groq: 'Groq',
};
