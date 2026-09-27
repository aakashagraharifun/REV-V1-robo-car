import { base64ToBytes, bytesToBase64, utf8Decode, utf8Encode } from '../encoding';
import { redact } from '../logger';

describe('encoding', () => {
  // Expected values generated with Node's Buffer.
  it.each([
    ['', ''],
    ['a', 'YQ=='],
    ['ab', 'YWI='],
    ['abc', 'YWJj'],
    ['{"type":"oled","state":"idle"}\n', 'eyJ0eXBlIjoib2xlZCIsInN0YXRlIjoiaWRsZSJ9Cg=='],
    ['héllo wörld', 'aMOpbGxvIHfDtnJsZA=='],
    ['Robo 🤖 says hi', 'Um9ibyDwn6SWIHNheXMgaGk='],
  ])('round-trips %p through UTF-8 and base64', (text, base64) => {
    const b64 = bytesToBase64(utf8Encode(text));
    expect(b64).toBe(base64);
    expect(utf8Decode(base64ToBytes(b64))).toBe(text);
  });
});

describe('redact', () => {
  it('hides API keys and bearer tokens', () => {
    const text = 'key sk-or-v1-abcdef1234567890 and gsk_ABCDEFGH12345678 via Bearer abc.def-ghi';
    const result = redact(text);
    expect(result).not.toMatch(/abcdef1234567890|ABCDEFGH12345678|abc\.def-ghi/);
    expect(result.match(/\[REDACTED\]/g)).toHaveLength(3);
  });
});
