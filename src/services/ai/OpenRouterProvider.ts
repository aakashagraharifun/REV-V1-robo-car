import { ROBOT_NAME } from '@/config/robotConfig';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';

/** OpenRouter (https://openrouter.ai) — one API key, many models. */
export class OpenRouterProvider extends OpenAICompatibleProvider {
  readonly id = 'openrouter' as const;
  readonly displayName = 'OpenRouter';

  protected override extraHeaders(): Record<string, string> {
    // Optional attribution headers recognised by OpenRouter.
    return { 'X-Title': `${ROBOT_NAME} Car Companion` };
  }
}
