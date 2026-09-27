import { utf8Decode, utf8Encode } from '@/utils/encoding';
import {
  buildAudioStartMessage,
  buildCarCommandMessage,
  buildOLEDMessage,
  chunkBytes,
  encodeMessage,
  MessageDecoder,
} from '../bleProtocol';

const decode = (bytes: Uint8Array) => utf8Decode(bytes);

describe('encoding outgoing messages', () => {
  it('encodes movement as newline-terminated JSON without internal fields', () => {
    const frame = encodeMessage(buildCarCommandMessage({ command: 'forward', speed: 70.4, durationMs: 2000, source: 'ai' }));
    expect(decode(frame)).toBe('{"type":"car_command","command":"forward","speed":70}\n');
  });

  it('encodes the audio control messages', () => {
    expect(decode(encodeMessage(buildAudioStartMessage(32000, 16000)))).toBe(
      '{"type":"audio_start","format":"ima_adpcm","sampleRate":16000,"samples":32000,"bytes":16000}\n',
    );
    expect(decode(encodeMessage({ type: 'audio_end' }))).toBe('{"type":"audio_end"}\n');
    expect(decode(encodeMessage({ type: 'audio_stop' }))).toBe('{"type":"audio_stop"}\n');
  });

  it('encodes stop without a speed', () => {
    const frame = encodeMessage(buildCarCommandMessage({ command: 'stop', speed: 0, source: 'manual' }));
    expect(decode(frame)).toBe('{"type":"car_command","command":"stop"}\n');
  });

  it('encodes OLED states', () => {
    expect(decode(encodeMessage(buildOLEDMessage('listening')))).toBe('{"type":"oled","state":"listening"}\n');
  });

  it('splits frames to fit the MTU and reassembles losslessly', () => {
    const frame = encodeMessage(buildCarCommandMessage({ command: 'backward', speed: 55, source: 'manual' }));
    const chunks = chunkBytes(frame, 20);
    expect(chunks.every((c) => c.length <= 20)).toBe(true);
    expect(chunks.map(decode).join('')).toBe(decode(frame));
  });
});

describe('MessageDecoder', () => {
  it('reassembles a status frame split across notifications', () => {
    const decoder = new MessageDecoder();
    const json = '{"type":"status","state":"moving","command":"left","speed":40,"battery":81}\n';
    const [a, b] = [json.slice(0, 25), json.slice(25)];
    expect(decoder.push(utf8Encode(a ?? ''))).toEqual([]);
    expect(decoder.push(utf8Encode(b ?? ''))).toEqual([
      { type: 'status', state: 'moving', command: 'left', speed: 40, battery: 81, message: null },
    ]);
  });

  it('handles several frames in one notification and skips bad ones', () => {
    const decoder = new MessageDecoder();
    const payload =
      '{"type":"status","state":"stopped"}\n' +
      'not json\n' +
      '{"type":"status","state":"flying"}\n' +
      '{"type":"status","state":"moving","speed":400}\n';
    const messages = decoder.push(utf8Encode(payload));
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ state: 'stopped', speed: 0, battery: null, command: null });
    expect(messages[1]).toMatchObject({ state: 'moving', speed: 100 });
  });

  it('drops an oversized buffer instead of growing forever', () => {
    const decoder = new MessageDecoder();
    expect(decoder.push(utf8Encode('x'.repeat(5000)))).toEqual([]);
    expect(decoder.push(utf8Encode('{"type":"status","state":"idle"}\n'))).toHaveLength(1);
  });
});
