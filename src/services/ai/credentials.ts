/**
 * API key storage for development/prototype use.
 *
 * Lookup order: key entered in Settings (stored in the OS keystore via
 * expo-secure-store) → EXPO_PUBLIC_* variable baked in at build time.
 *
 * Keys are kept out of the global UI store and never logged. Remember that a
 * key shipped inside an app can always be extracted — see README
 * "API key security".
 */
import * as SecureStore from 'expo-secure-store';

import { AI_ENV } from '@/config/aiConfig';
import type { AIProviderId } from '@/types/ai';
import { createLogger } from '@/utils/logger';

const log = createLogger('Credentials');
const STORAGE_KEYS: Record<AIProviderId, string> = {
  openrouter: 'robo.apiKey.openrouter',
  groq: 'robo.apiKey.groq',
};

export type KeySource = 'settings' | 'env' | 'none';

const runtimeKeys: Partial<Record<AIProviderId, string>> = {};

export const credentials = {
  getApiKey(provider: AIProviderId): string {
    return runtimeKeys[provider] || AI_ENV[provider].apiKey;
  },

  keySource(provider: AIProviderId): KeySource {
    if (runtimeKeys[provider]) return 'settings';
    if (AI_ENV[provider].apiKey) return 'env';
    return 'none';
  },

  async load(): Promise<void> {
    for (const provider of Object.keys(STORAGE_KEYS) as AIProviderId[]) {
      try {
        const value = await SecureStore.getItemAsync(STORAGE_KEYS[provider]);
        if (value) runtimeKeys[provider] = value;
      } catch (error) {
        log.warn('Secure storage unavailable', error);
      }
    }
  },

  async setApiKey(provider: AIProviderId, key: string): Promise<void> {
    const trimmed = key.trim();
    if (!trimmed) return credentials.clearApiKey(provider);
    runtimeKeys[provider] = trimmed;
    try {
      await SecureStore.setItemAsync(STORAGE_KEYS[provider], trimmed);
    } catch (error) {
      log.warn('Could not persist key; it will be forgotten on restart', error);
    }
  },

  async clearApiKey(provider: AIProviderId): Promise<void> {
    delete runtimeKeys[provider];
    try {
      await SecureStore.deleteItemAsync(STORAGE_KEYS[provider]);
    } catch (error) {
      log.warn('Could not clear stored key', error);
    }
  },
};
