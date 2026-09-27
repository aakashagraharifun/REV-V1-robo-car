/**
 * Generates the synthesized soundboard clips (robot, beep) in assets/sounds/
 * as small 16-bit mono WAV files (no third-party audio).
 *
 *   npm run generate:sounds
 *
 * The animal and laugh clips are real recordings — see
 * scripts/fetch-real-sounds.mjs. Keep every clip 16-bit PCM WAV: the app
 * decodes them to stream to the car's speaker.
 */
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 22050;
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sounds');

function buffer(seconds) {
  return new Float32Array(Math.ceil(seconds * SAMPLE_RATE));
}

/** Attack/release envelope, values in seconds. */
function envelope(t, length, attack, release) {
  if (t < attack) return t / attack;
  if (t > length - release) return Math.max(0, (length - t) / release);
  return 1;
}

function lowpass(samples, cutoffHz) {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / SAMPLE_RATE;
  const alpha = dt / (rc + dt);
  let prev = 0;
  for (let i = 0; i < samples.length; i++) {
    prev += alpha * (samples[i] - prev);
    samples[i] = prev;
  }
  return samples;
}

/** Oscillator with a frequency function f(t); shape: sine | saw | square. */
function tone(out, start, length, freqAt, shape, gain = 1, attack = 0.01, release = 0.05) {
  let phase = 0;
  const first = Math.floor(start * SAMPLE_RATE);
  const count = Math.floor(length * SAMPLE_RATE);
  for (let i = 0; i < count && first + i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    phase += freqAt(t) / SAMPLE_RATE;
    const p = phase % 1;
    let v;
    if (shape === 'sine') v = Math.sin(2 * Math.PI * p);
    else if (shape === 'saw') v = 2 * p - 1;
    else v = p < 0.5 ? 1 : -1;
    out[first + i] += v * gain * envelope(t, length, attack, release);
  }
}

function normalize(samples, peak = 0.85) {
  let max = 0;
  for (const s of samples) max = Math.max(max, Math.abs(s));
  if (max === 0) return samples;
  for (let i = 0; i < samples.length; i++) samples[i] = (samples[i] / max) * peak;
  return samples;
}

function toWav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const sounds = {
  beep() {
    const out = buffer(0.55);
    tone(out, 0, 0.18, () => 880, 'sine', 1, 0.005, 0.03);
    tone(out, 0.28, 0.2, () => 1175, 'sine', 1, 0.005, 0.03);
    return out;
  },

  robot() {
    const out = buffer(1.0);
    const notes = [523, 784, 392, 659, 988, 440, 1319];
    notes.forEach((f, i) => tone(out, i * 0.13, 0.11, () => f, 'square', 0.5, 0.003, 0.02));
    // Bit-crush for a chiptune feel.
    for (let i = 0; i < out.length; i++) out[i] = Math.round(out[i] * 6) / 6;
    return lowpass(out, 5000);
  },
};

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, make] of Object.entries(sounds)) {
  const path = join(OUT_DIR, `${name}.wav`);
  writeFileSync(path, toWav(normalize(make())));
  console.log(`wrote ${path}`);
}
