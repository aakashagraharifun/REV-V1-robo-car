import { aiService } from '@/services/ai/AIService';
import { routeUserInput } from '../intentRouter';

jest.mock('@/services/ai/AIService', () => ({
  aiService: { generateResponse: jest.fn() },
}));

const generate = aiService.generateResponse as jest.MockedFunction<typeof aiService.generateResponse>;
const ctx = { history: [], speedLimit: 80 };

function aiReplies(text: string) {
  generate.mockResolvedValueOnce({ text, provider: 'groq', model: 'test-model' });
}

beforeEach(() => generate.mockReset());

describe('routeUserInput', () => {
  it('handles simple commands offline without calling the AI', async () => {
    await expect(routeUserInput('Go forward', ctx)).resolves.toMatchObject({
      type: 'CAR_COMMAND',
      origin: 'rules',
      command: { command: 'forward', speed: 50, durationMs: 2000, source: 'voice' },
    });
    await expect(routeUserInput('make a cow sound', ctx)).resolves.toEqual({
      type: 'SOUND_REQUEST',
      sound: 'cow',
      origin: 'rules',
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it('rejects offline commands that break safety limits', async () => {
    await expect(routeUserInput('go forward for 30 seconds', ctx)).resolves.toMatchObject({
      type: 'REJECTED',
      intent: 'CAR_COMMAND',
    });
  });

  it('passes AI answers through', async () => {
    aiReplies('{"intent":"AI_QUESTION","response":"Sunlight scatters off air molecules."}');
    await expect(routeUserInput('Why is the sky blue?', ctx)).resolves.toEqual({
      type: 'AI_QUESTION',
      response: 'Sunlight scatters off air molecules.',
      origin: 'ai',
    });
  });

  it('blocks AI-proposed movement the user did not ask for', async () => {
    aiReplies('{"intent":"CAR_COMMAND","command":"forward","speed":60}');
    await expect(routeUserInput('I feel a bit sad today', ctx)).resolves.toMatchObject({
      type: 'REJECTED',
      intent: 'CAR_COMMAND',
    });
  });

  it('validates AI-proposed movement when the user asked for it', async () => {
    aiReplies('{"intent":"CAR_COMMAND","command":"forward","speed":60}');
    await expect(routeUserInput('could you zoom ahead a little', ctx)).resolves.toMatchObject({
      type: 'CAR_COMMAND',
      origin: 'ai',
      command: { command: 'forward', speed: 60, durationMs: 2000, source: 'ai' },
    });

    aiReplies('{"intent":"CAR_COMMAND","command":"forward","speed":250}');
    await expect(routeUserInput('could you zoom ahead a little', ctx)).resolves.toMatchObject({ type: 'REJECTED' });
  });

  it('always allows an AI-proposed stop', async () => {
    aiReplies('{"intent":"CAR_COMMAND","command":"stop"}');
    await expect(routeUserInput('enough of that', ctx)).resolves.toMatchObject({
      type: 'CAR_COMMAND',
      command: { command: 'stop', speed: 0 },
    });
  });

  it('rejects unknown sounds and falls back to plain text replies', async () => {
    aiReplies('{"intent":"SOUND_REQUEST","sound":"elephant"}');
    await expect(routeUserInput('do an elephant', ctx)).resolves.toMatchObject({ type: 'REJECTED', intent: 'SOUND_REQUEST' });

    aiReplies('Hello there, friend!');
    await expect(routeUserInput('hello', ctx)).resolves.toEqual({
      type: 'GENERAL_CONVERSATION',
      response: 'Hello there, friend!',
      origin: 'ai',
    });
  });

  it('sends the system prompt, history as JSON, and the user message', async () => {
    aiReplies('{"intent":"GENERAL_CONVERSATION","response":"Hi!"}');
    await routeUserInput('hello', {
      speedLimit: 80,
      history: [
        { id: '1', author: 'user', text: 'hey', createdAt: 0, kind: 'text' },
        { id: '2', author: 'robo', text: 'Hi!', createdAt: 0, kind: 'text', intent: 'GENERAL_CONVERSATION' },
        { id: '3', author: 'robo', text: 'Network down', createdAt: 0, kind: 'error' },
      ],
    });
    const messages = generate.mock.calls[0]?.[0] ?? [];
    expect(messages[0]?.role).toBe('system');
    expect(messages.slice(1)).toEqual([
      { role: 'user', content: 'hey' },
      { role: 'assistant', content: '{"intent":"GENERAL_CONVERSATION","response":"Hi!"}' },
      { role: 'user', content: 'hello' },
    ]);
  });
});
