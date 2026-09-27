import { SAFETY_CONFIG } from '@/config/safetyConfig';
import { parseRawIntent, sanitizeResponse, validateCarCommand, validateSound } from '../commandValidator';

const manual = { source: 'manual' as const, speedLimit: 80 };
const ai = { source: 'ai' as const, speedLimit: 80 };

describe('validateCarCommand', () => {
  it('accepts a manual hold-to-drive command without duration', () => {
    expect(validateCarCommand({ command: 'forward', speed: 70 }, manual)).toEqual({
      ok: true,
      value: { command: 'forward', speed: 70, durationMs: undefined, source: 'manual' },
    });
  });

  it('clamps speed to the user speed limit', () => {
    const result = validateCarCommand({ command: 'left', speed: 95 }, manual);
    expect(result.ok && result.value.speed).toBe(80);
  });

  it.each([150, -5, 'fast', NaN, Infinity])('rejects invalid speed %p', (speed) => {
    expect(validateCarCommand({ command: 'forward', speed }, manual).ok).toBe(false);
  });

  it('rejects unknown commands and non-objects', () => {
    expect(validateCarCommand({ command: 'jump', speed: 50 }, manual).ok).toBe(false);
    expect(validateCarCommand({ command: 'gpio_write', speed: 50 }, ai).ok).toBe(false);
    expect(validateCarCommand('forward', manual).ok).toBe(false);
    expect(validateCarCommand(null, manual).ok).toBe(false);
  });

  it('requires speed for manual commands', () => {
    expect(validateCarCommand({ command: 'forward' }, manual).ok).toBe(false);
  });

  it('gives AI/voice commands a default speed and a bounded duration', () => {
    const result = validateCarCommand({ command: 'forward' }, ai);
    expect(result).toEqual({
      ok: true,
      value: {
        command: 'forward',
        speed: SAFETY_CONFIG.DEFAULT_VOICE_SPEED,
        durationMs: SAFETY_CONFIG.DEFAULT_COMMAND_DURATION_MS,
        source: 'ai',
      },
    });
  });

  it('rejects durations outside the safe range', () => {
    expect(validateCarCommand({ command: 'forward', duration: 10_000 }, ai).ok).toBe(false);
    expect(validateCarCommand({ command: 'forward', duration: 50 }, ai).ok).toBe(false);
    expect(validateCarCommand({ command: 'forward', duration: '3000' }, ai)).toMatchObject({
      ok: true,
      value: { durationMs: 3000 },
    });
  });

  it('normalises case and always zeroes speed on stop', () => {
    expect(validateCarCommand({ command: 'FORWARD', speed: 10 }, manual).ok).toBe(true);
    expect(validateCarCommand({ command: 'stop', speed: 99 }, ai)).toEqual({
      ok: true,
      value: { command: 'stop', speed: 0, source: 'ai' },
    });
  });
});

describe('validateSound', () => {
  it('accepts known sounds only', () => {
    expect(validateSound(' Cow ')).toEqual({ ok: true, value: 'cow' });
    expect(validateSound('elephant').ok).toBe(false);
    expect(validateSound(42).ok).toBe(false);
  });
});

describe('parseRawIntent', () => {
  it('extracts JSON from code fences and prose', () => {
    const result = parseRawIntent('Sure!\n```json\n{"intent":"car_command","command":"left","speed":40}\n```');
    expect(result).toMatchObject({ ok: true, value: { intent: 'CAR_COMMAND', command: 'left', speed: 40 } });
  });

  it('rejects missing, invalid or unknown intents', () => {
    expect(parseRawIntent('The sky is blue.').ok).toBe(false);
    expect(parseRawIntent('{"intent": }').ok).toBe(false);
    expect(parseRawIntent('{"intent":"RUN_CODE","code":"rm -rf /"}').ok).toBe(false);
  });
});

describe('sanitizeResponse', () => {
  it('strips code blocks and bounds length', () => {
    expect(sanitizeResponse('Hi ```js\nalert(1)\n``` there')).toBe('Hi  there');
    expect(sanitizeResponse('x'.repeat(2000))?.length).toBe(1200);
    expect(sanitizeResponse(123)).toBeNull();
    expect(sanitizeResponse('   ')).toBeNull();
  });
});
