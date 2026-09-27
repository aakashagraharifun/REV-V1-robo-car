/**
 * Persists user settings (not secrets — keys live in services/ai/credentials).
 * Uses expo-secure-store simply because it's already a dependency and the
 * payload is tiny; failures fall back to defaults.
 */
import * as SecureStore from 'expo-secure-store';

import { SAFETY_CONFIG } from '@/config/safetyConfig';
import type { AIProviderId } from '@/types/ai';
import type { AudioOutputTarget } from '@/types/audio';
import type { VoiceSettings } from '@/types/voice';
import { clamp } from '@/utils/async';
import { createLogger } from '@/utils/logger';

const log = createLogger('Settings');
// v2: the provider is only stored when chosen in Settings (v1 stored it always, shadowing .env).
const STORAGE_KEY = 'robo.settings.v2';

export interface PersistedSettings {
  /** null = not chosen in Settings; use EXPO_PUBLIC_AI_PROVIDER. */
  aiProvider: AIProviderId | null;
  aiModels: Record<AIProviderId, string>;
  voiceSettings: VoiceSettings;
  speed: number;
  speedLimit: number;
  autoReconnect: boolean;
  audioOutput: AudioOutputTarget;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

/** Parses stored JSON defensively; unknown fields are ignored, bad values fall back. */
function parse(raw: string, defaults: PersistedSettings): PersistedSettings {
  const data: unknown = JSON.parse(raw);
  if (!isRecord(data)) return defaults;
  const models = isRecord(data.aiModels) ? data.aiModels : {};
  const voice = isRecord(data.voiceSettings) ? data.voiceSettings : {};
  return {
    aiProvider: data.aiProvider === 'groq' || data.aiProvider === 'openrouter' ? data.aiProvider : defaults.aiProvider,
    aiModels: {
      openrouter: str(models.openrouter, defaults.aiModels.openrouter),
      groq: str(models.groq, defaults.aiModels.groq),
    },
    voiceSettings: {
      autoSpeak: typeof voice.autoSpeak === 'boolean' ? voice.autoSpeak : defaults.voiceSettings.autoSpeak,
      language: str(voice.language, defaults.voiceSettings.language),
      rate: num(voice.rate, defaults.voiceSettings.rate, 0.5, 2),
      pitch: num(voice.pitch, defaults.voiceSettings.pitch, 0.5, 2),
    },
    speed: num(data.speed, defaults.speed, 0, SAFETY_CONFIG.HARD_MAX_SPEED),
    speedLimit: num(data.speedLimit, defaults.speedLimit, 10, SAFETY_CONFIG.HARD_MAX_SPEED),
    autoReconnect: typeof data.autoReconnect === 'boolean' ? data.autoReconnect : defaults.autoReconnect,
    audioOutput: data.audioOutput === 'phone' || data.audioOutput === 'esp32' ? data.audioOutput : defaults.audioOutput,
  };
}

export async function loadSettings(defaults: PersistedSettings): Promise<PersistedSettings> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    return raw ? parse(raw, defaults) : defaults;
  } catch (error) {
    log.warn('Could not load settings, using defaults', error);
    return defaults;
  }
}

export async function saveSettings(settings: PersistedSettings): Promise<void> {
  try {
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    log.warn('Could not save settings', error);
  }
}
