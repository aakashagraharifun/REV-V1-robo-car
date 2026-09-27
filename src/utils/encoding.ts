/**
 * UTF-8 and base64 helpers. react-native-ble-plx exchanges characteristic
 * values as base64 strings; these helpers avoid depending on Buffer or on
 * TextEncoder/TextDecoder availability in the JS engine.
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) B64_LOOKUP[B64.charAt(i)] = i;

export function utf8Encode(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    if (cp < 0x80) bytes.push(cp);
    else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
  }
  return Uint8Array.from(bytes);
}

export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++] ?? 0;
    let cp: number;
    if (b0 < 0x80) cp = b0;
    else if (b0 >= 0xf0) cp = ((b0 & 0x07) << 18) | (((bytes[i++] ?? 0) & 0x3f) << 12) | (((bytes[i++] ?? 0) & 0x3f) << 6) | ((bytes[i++] ?? 0) & 0x3f);
    else if (b0 >= 0xe0) cp = ((b0 & 0x0f) << 12) | (((bytes[i++] ?? 0) & 0x3f) << 6) | ((bytes[i++] ?? 0) & 0x3f);
    else if (b0 >= 0xc0) cp = ((b0 & 0x1f) << 6) | ((bytes[i++] ?? 0) & 0x3f);
    else cp = 0xfffd; // stray continuation byte
    out += String.fromCodePoint(cp);
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63);
    out += b === undefined ? '=' : B64.charAt((n >> 6) & 63);
    out += c === undefined ? '=' : B64.charAt(n & 63);
  }
  return out;
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      ((B64_LOOKUP[clean.charAt(i)] ?? 0) << 18) |
      ((B64_LOOKUP[clean.charAt(i + 1)] ?? 0) << 12) |
      ((B64_LOOKUP[clean.charAt(i + 2)] ?? 0) << 6) |
      (B64_LOOKUP[clean.charAt(i + 3)] ?? 0);
    bytes.push((n >> 16) & 255);
    if (i + 2 < clean.length) bytes.push((n >> 8) & 255);
    if (i + 3 < clean.length) bytes.push(n & 255);
  }
  return Uint8Array.from(bytes);
}
