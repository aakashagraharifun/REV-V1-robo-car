import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';

/** Groq (https://groq.com) — very low-latency inference, handy for voice. */
export class GroqProvider extends OpenAICompatibleProvider {
  readonly id = 'groq' as const;
  readonly displayName = 'Groq';
}
