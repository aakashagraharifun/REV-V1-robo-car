/**
 * Shared implementation for providers that expose an OpenAI-style
 * `POST {baseUrl}/chat/completions` endpoint (OpenRouter, Groq, and most
 * self-hosted proxies). Handles timeouts, HTTP error mapping and defensive
 * response parsing so subclasses only declare identity and headers.
 */
import { AI_CONFIG } from '@/config/aiConfig';
import type { AIMessage, AIProviderId, AIResponse, GenerateOptions } from '@/types/ai';
import { createLogger } from '@/utils/logger';
import { AIError, type AIProvider } from './AIProvider';

const log = createLogger('AI');

export interface ProviderSettings {
  apiKey: string;
  model: string;
  baseUrl: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Pulls `error.message` out of an OpenAI-style error body, if present. */
function extractErrorMessage(body: unknown): string {
  if (isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string') {
    return body.error.message.slice(0, 300);
  }
  return '';
}

function extractContent(body: unknown): string | null {
  if (!isRecord(body) || !Array.isArray(body.choices)) return null;
  const first: unknown = body.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return null;
  const content = first.message.content;
  if (typeof content === 'string') return content;
  // Some providers return content parts: [{ type: 'text', text: '...' }]
  if (Array.isArray(content)) {
    return content
      .map((part: unknown) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
      .join('');
  }
  return null;
}

function mapHttpError(status: number, message: string): AIError {
  const lower = message.toLowerCase();
  const mentionsModel = lower.includes('model');
  if (status === 401) return new AIError('invalid_api_key', message, status);
  if (status === 402) return new AIError('insufficient_credits', message, status);
  if (status === 403) {
    return lower.includes('moderat') || lower.includes('flagged')
      ? new AIError('content_blocked', message, status)
      : new AIError('invalid_api_key', message, status);
  }
  if (status === 404) return new AIError('model_unavailable', message, status);
  if (status === 408) return new AIError('timeout', message, status);
  if (status === 429) return new AIError('rate_limited', message, status);
  if (status === 400 && mentionsModel) return new AIError('model_unavailable', message, status);
  if (status >= 500) {
    return mentionsModel
      ? new AIError('model_unavailable', message, status)
      : new AIError('server_error', message, status);
  }
  return new AIError('unknown', message || `HTTP ${status}`, status);
}

export abstract class OpenAICompatibleProvider implements AIProvider {
  abstract readonly id: AIProviderId;
  abstract readonly displayName: string;

  constructor(private readonly getSettings: () => ProviderSettings) {}

  /** Provider-specific headers (never include secrets other than Authorization). */
  protected extraHeaders(): Record<string, string> {
    return {};
  }

  isConfigured(): boolean {
    const { apiKey, model } = this.getSettings();
    return apiKey.length > 0 && model.length > 0;
  }

  async generateResponse(messages: AIMessage[], options: GenerateOptions = {}): Promise<AIResponse> {
    const { apiKey, model, baseUrl } = this.getSettings();
    if (!apiKey) throw new AIError('missing_api_key', this.displayName);
    if (!model) throw new AIError('missing_model', this.displayName);

    const timeoutMs = options.timeoutMs ?? AI_CONFIG.REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onExternalAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onExternalAbort);

    let response: Response;
    try {
      response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...this.extraHeaders(),
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: options.temperature ?? AI_CONFIG.TEMPERATURE,
          max_tokens: options.maxTokens ?? AI_CONFIG.MAX_TOKENS,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) throw new AIError('timeout');
      if (options.signal?.aborted) throw new AIError('aborted');
      log.warn(`${this.displayName} request failed`, error);
      throw new AIError('network', error instanceof Error ? error.message : undefined);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onExternalAbort);
    }

    let body: unknown;
    try {
      const raw = await response.text();
      body = raw.length > 0 ? JSON.parse(raw) : null;
    } catch {
      if (!response.ok) throw mapHttpError(response.status, '');
      throw new AIError('invalid_response', 'body is not JSON', response.status);
    }

    if (!response.ok) {
      const error = mapHttpError(response.status, extractErrorMessage(body));
      log.warn(`${this.displayName} HTTP ${response.status}`, error.message);
      throw error;
    }

    // OpenRouter can return HTTP 200 with an `error` object (e.g. upstream failure).
    const inlineError = extractErrorMessage(body);
    if (inlineError && isRecord(body) && isRecord(body.error)) {
      const code = typeof body.error.code === 'number' ? body.error.code : 500;
      throw mapHttpError(code, inlineError);
    }

    const content = extractContent(body);
    if (content === null) throw new AIError('invalid_response', 'missing choices[0].message.content');
    const text = content.trim();
    if (!text) throw new AIError('empty_response');

    return { text, provider: this.id, model };
  }
}
