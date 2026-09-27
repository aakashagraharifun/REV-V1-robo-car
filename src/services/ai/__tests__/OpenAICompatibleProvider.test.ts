import { AIError } from '../AIProvider';
import { OpenAICompatibleProvider, type ProviderSettings } from '../OpenAICompatibleProvider';

class TestProvider extends OpenAICompatibleProvider {
  readonly id = 'groq' as const;
  readonly displayName = 'Test';
}

let settings: ProviderSettings;
const provider = new TestProvider(() => settings);
const messages = [{ role: 'user' as const, content: 'hi' }];

function mockFetch(status: number, body: unknown) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const fn = jest.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, text: async () => text });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

async function expectCode(code: AIError['code']) {
  await expect(provider.generateResponse(messages)).rejects.toMatchObject({ name: 'AIError', code });
}

beforeAll(() => {
  // Failures are logged by design; keep test output readable.
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

beforeEach(() => {
  settings ={ apiKey: 'gsk_testkey1234567890', model: 'test-model', baseUrl: 'https://api.example.com/v1/' };
});

describe('OpenAICompatibleProvider', () => {
  it('sends an OpenAI-style request and returns the reply text', async () => {
    const fetchMock = mockFetch(200, { choices: [{ message: { content: '  Hello!  ' } }] });
    await expect(provider.generateResponse(messages)).resolves.toEqual({
      text: 'Hello!',
      provider: 'groq',
      model: 'test-model',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gsk_testkey1234567890');
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'test-model', messages });
  });

  it('refuses to call the API without a key or model', async () => {
    const fetchMock = mockFetch(200, {});
    settings.apiKey = '';
    await expectCode('missing_api_key');
    settings.apiKey = 'k';
    settings.model = '';
    await expectCode('missing_model');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'invalid_api_key'],
    [402, 'insufficient_credits'],
    [404, 'model_unavailable'],
    [429, 'rate_limited'],
    [503, 'server_error'],
  ] as const)('maps HTTP %i to %s', async (status, code) => {
    mockFetch(status, { error: { message: 'nope' } });
    await expectCode(code);
  });

  it('maps a 400 about the model to model_unavailable', async () => {
    mockFetch(400, { error: { message: 'The model `x` does not exist' } });
    await expectCode('model_unavailable');
  });

  it('handles OpenRouter-style errors inside a 200 response', async () => {
    mockFetch(200, { error: { code: 429, message: 'Rate limit exceeded' } });
    await expectCode('rate_limited');
  });

  it('detects empty and malformed responses', async () => {
    mockFetch(200, { choices: [{ message: { content: '   ' } }] });
    await expectCode('empty_response');
    mockFetch(200, { choices: [] });
    await expectCode('invalid_response');
    mockFetch(200, '<html>oops</html>');
    await expectCode('invalid_response');
  });

  it('reports network failures and timeouts', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed')) as unknown as typeof fetch;
    await expectCode('network');

    globalThis.fetch = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;
    await expect(provider.generateResponse(messages, { timeoutMs: 20 })).rejects.toMatchObject({ code: 'timeout' });
  });
});
