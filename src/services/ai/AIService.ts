/**
 * Provider-agnostic AI entry point. Switch providers with
 * `aiService.setActiveProvider('groq')` (Settings does this) or via
 * EXPO_PUBLIC_AI_PROVIDER. To route through your own backend later, point
 * EXPO_PUBLIC_*_BASE_URL at it — nothing else changes.
 */
import { AI_ENV } from '@/config/aiConfig';
import type { AIMessage, AIProviderId, AIResponse, GenerateOptions } from '@/types/ai';
import type { AIProvider } from './AIProvider';
import { credentials } from './credentials';
import { GroqProvider } from './GroqProvider';
import { OpenRouterProvider } from './OpenRouterProvider';

class AIService {
  private activeId: AIProviderId = AI_ENV.provider;
  private modelOverrides: Partial<Record<AIProviderId, string>> = {};
  private readonly providers: Record<AIProviderId, AIProvider>;

  constructor() {
    const settingsFor = (id: AIProviderId) => () => ({
      apiKey: credentials.getApiKey(id),
      model: this.getModel(id),
      baseUrl: AI_ENV[id].baseUrl,
    });
    this.providers = {
      openrouter: new OpenRouterProvider(settingsFor('openrouter')),
      groq: new GroqProvider(settingsFor('groq')),
    };
  }

  get activeProviderId(): AIProviderId {
    return this.activeId;
  }

  getProvider(id: AIProviderId = this.activeId): AIProvider {
    return this.providers[id];
  }

  setActiveProvider(id: AIProviderId): void {
    this.activeId = id;
  }

  /** Model chosen in Settings, falling back to the EXPO_PUBLIC_*_MODEL value. */
  getModel(id: AIProviderId): string {
    return this.modelOverrides[id] || AI_ENV[id].model;
  }

  setModel(id: AIProviderId, model: string): void {
    const trimmed = model.trim();
    if (trimmed) this.modelOverrides[id] = trimmed;
    else delete this.modelOverrides[id];
  }

  isConfigured(id: AIProviderId = this.activeId): boolean {
    return this.providers[id].isConfigured();
  }

  generateResponse(messages: AIMessage[], options?: GenerateOptions): Promise<AIResponse> {
    return this.providers[this.activeId].generateResponse(messages, options);
  }
}

export const aiService = new AIService();
