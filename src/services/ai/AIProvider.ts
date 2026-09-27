import type { AIErrorCode, AIMessage, AIProviderId, AIResponse, GenerateOptions } from '@/types/ai';

/**
 * Contract every AI backend implements. The rest of the app only talks to
 * this interface (through AIService), never to a vendor SDK or URL.
 */
export interface AIProvider {
  readonly id: AIProviderId;
  readonly displayName: string;
  /** True when an API key and model are configured. */
  isConfigured(): boolean;
  generateResponse(messages: AIMessage[], options?: GenerateOptions): Promise<AIResponse>;
}

const USER_MESSAGES: Record<AIErrorCode, string> = {
  missing_api_key: 'No API key set. Add one in Settings → AI to chat with me.',
  missing_model: 'No AI model chosen. Set one in Settings → AI.',
  invalid_api_key: 'The AI key was rejected. Check it in Settings → AI.',
  rate_limited: 'I’m getting too many questions right now. Wait a moment and try again.',
  insufficient_credits: 'The AI account is out of credits.',
  content_blocked: 'I can’t answer that one. Let’s talk about something else!',
  model_unavailable: 'That AI model isn’t available right now. Try another model in Settings.',
  network: 'I can’t reach the internet. Check the phone’s connection.',
  timeout: 'The AI took too long to answer. Try again.',
  invalid_response: 'I got a confusing answer from the AI. Try asking again.',
  empty_response: 'The AI didn’t say anything. Try asking again.',
  server_error: 'The AI service is having trouble. Try again soon.',
  aborted: 'Cancelled.',
  unknown: 'Something went wrong talking to the AI.',
};

export class AIError extends Error {
  readonly code: AIErrorCode;
  readonly userMessage: string;
  readonly status: number | null;

  constructor(code: AIErrorCode, detail?: string, status: number | null = null) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'AIError';
    this.code = code;
    this.status = status;
    this.userMessage = USER_MESSAGES[code];
  }
}
