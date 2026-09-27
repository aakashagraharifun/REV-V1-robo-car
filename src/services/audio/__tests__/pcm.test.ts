import { decodeImaAdpcm, encodeImaAdpcm, normalizePeak, resample } from '../pcm';
import { parseWav, WavFormatError } from '../wav';

// Jest runs in Node, but the app's tsconfig has no Node types: declare just what's used here.
declare const __dirname: string;
/* eslint-disable @typescript-eslint/no-require-imports */
const { readFileSync } = require('fs') as { readFileSync(path: string): Uint8Array };
const { join } = require('path') as { join(...parts: string[]): string };
/* eslint-enable @typescript-eslint/no-require-imports */

function sine(freq: number, rate: number, seconds: number, amplitude = 12000): Int16Array {
  const out = new Int16Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i++) out[i] = Math.round(amplitude * Math.sin((2 * Math.PI * freq * i) / rate));
  return out;
}

/** Signal-to-noise ratio of `actual` against `expected`, in dB. */
function snr(expected: Int16Array, actual: Int16Array): number {
  let signal = 0;
  let noise = 0;
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i] ?? 0;
    signal += e * e;
    noise += (e - (actual[i] ?? 0)) ** 2;
  }
  return 10 * Math.log10(signal / Math.max(1, noise));
}

function wav(opts: { rate: number; channels: number; bits: number; frames: number[][]; extraChunk?: boolean }): Uint8Array {
  const bytesPerSample = opts.bits / 8;
  const data = opts.frames.length * opts.channels * bytesPerSample;
  const extra = opts.extraChunk ? 12 : 0;
  const buf = new DataView(new ArrayBuffer(44 + extra + data));
  const text = (at: number, s: string) => [...s].forEach((c, i) => buf.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  buf.setUint32(4, 36 + extra + data, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  buf.setUint32(16, 16, true);
  buf.setUint16(20, 1, true);
  buf.setUint16(22, opts.channels, true);
  buf.setUint32(24, opts.rate, true);
  buf.setUint32(28, opts.rate * opts.channels * bytesPerSample, true);
  buf.setUint16(32, opts.channels * bytesPerSample, true);
  buf.setUint16(34, opts.bits, true);
  let at = 36;
  if (opts.extraChunk) {
    text(at, 'LIST');
    buf.setUint32(at + 4, 4, true);
    text(at + 8, 'INFO');
    at += 12;
  }
  text(at, 'data');
  buf.setUint32(at + 4, data, true);
  at += 8;
  for (const frame of opts.frames) {
    for (const v of frame) {
      if (opts.bits === 8) buf.setUint8(at, v);
      else buf.setInt16(at, v, true);
      at += bytesPerSample;
    }
  }
  return new Uint8Array(buf.buffer);
}

describe('parseWav', () => {
  it('reads 16-bit stereo, mixing to mono, and skips extra chunks', () => {
    const decoded = parseWav(wav({ rate: 24000, channels: 2, bits: 16, frames: [[1000, 3000], [-200, -400]], extraChunk: true }));
    expect(decoded.sampleRate).toBe(24000);
    expect(Array.from(decoded.samples)).toEqual([2000, -300]);
  });

  it('reads unsigned 8-bit samples', () => {
    const decoded = parseWav(wav({ rate: 8000, channels: 1, bits: 8, frames: [[128], [255], [0]] }));
    expect(Array.from(decoded.samples)).toEqual([0, 127 << 8, -128 << 8]);
  });

  it('rejects non-WAV data', () => {
    expect(() => parseWav(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toThrow(WavFormatError);
  });

  it.each(['cow', 'dog', 'cat', 'lion', 'laugh', 'robot', 'beep'])('decodes the bundled %s clip', (id) => {
    const bytes = new Uint8Array(readFileSync(join(__dirname, '../../../../assets/sounds', `${id}.wav`)));
    const decoded = parseWav(bytes);
    expect(decoded.sampleRate).toBe(22050);
    expect(decoded.samples.length).toBeGreaterThan(22050 * 0.4);
  });
});

describe('resample', () => {
  it('keeps duration and a tone intact when converting 24 kHz → 16 kHz', () => {
    const input = sine(440, 24000, 0.5);
    const out = resample(input, 24000, 16000);
    expect(out.length).toBe(8000);
    expect(snr(sine(440, 16000, 0.5), out)).toBeGreaterThan(25);
  });

  it('upsamples 8 kHz → 16 kHz', () => {
    const out = resample(sine(300, 8000, 0.25), 8000, 16000);
    expect(out.length).toBe(4000);
    expect(snr(sine(300, 16000, 0.25), out)).toBeGreaterThan(20);
  });
});

describe('normalizePeak', () => {
  it('boosts quiet audio but caps the gain', () => {
    const quiet = Int16Array.from([100, -1000, 500]);
    expect(Math.max(...normalizePeak(quiet).map(Math.abs))).toBe(4000);
    const medium = Int16Array.from([10000, -5000]);
    expect(normalizePeak(medium)[0]).toBe(Math.round(10000 * ((0.9 * 32767) / 10000)));
  });

  it('never makes loud audio quieter', () => {
    const loud = Int16Array.from([32000, -32000]);
    expect(Array.from(normalizePeak(loud))).toEqual([32000, -32000]);
  });
});

describe('IMA ADPCM', () => {
  it('packs two samples per byte', () => {
    expect(encodeImaAdpcm(new Int16Array(9)).length).toBe(5);
  });

  it('round-trips speech-like audio with good quality', () => {
    const input = sine(220, 16000, 0.5).map((v, i) => v + Math.round(4000 * Math.sin((2 * Math.PI * 1300 * i) / 16000)));
    const decoded = decodeImaAdpcm(encodeImaAdpcm(input), input.length);
    // Skip the first few ms while the step size adapts from its initial value.
    expect(snr(input.subarray(200), decoded.subarray(200))).toBeGreaterThan(20);
  });

  it('round-trips a real bundled clip', () => {
    const bytes = new Uint8Array(readFileSync(join(__dirname, '../../../../assets/sounds/cow.wav')));
    const pcm = resample(parseWav(bytes).samples, 22050, 16000);
    const decoded = decodeImaAdpcm(encodeImaAdpcm(pcm), pcm.length);
    expect(snr(pcm, decoded)).toBeGreaterThan(15);
  });
});
