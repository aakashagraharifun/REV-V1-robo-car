/**
 * Sample-level helpers for sending audio to the car: resampling, level
 * normalisation and IMA ADPCM (4 bits per sample, so 16 kHz speech needs only
 * 8 KB/s over BLE). The ESP32 firmware contains the matching decoder — keep
 * the step/index tables identical on both sides.
 */

/** Converts to `toRate` with a box filter when downsampling and linear interpolation when upsampling. */
export function resample(input: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate || input.length === 0) return input.slice();
  const ratio = fromRate / toRate;
  const out = new Int16Array(Math.max(1, Math.floor(input.length / ratio)));

  if (ratio > 1) {
    for (let i = 0; i < out.length; i++) {
      const from = Math.floor(i * ratio);
      const to = Math.max(from + 1, Math.min(input.length, Math.floor((i + 1) * ratio)));
      let sum = 0;
      for (let j = from; j < to; j++) sum += input[j] ?? 0;
      out[i] = Math.round(sum / (to - from));
    }
  } else {
    for (let i = 0; i < out.length; i++) {
      const pos = i * ratio;
      const j = Math.floor(pos);
      const frac = pos - j;
      const a = input[j] ?? 0;
      const b = input[Math.min(j + 1, input.length - 1)] ?? a;
      out[i] = Math.round(a + (b - a) * frac);
    }
  }
  return out;
}

/** Boosts quiet audio so its peak reaches `targetPeak` (0–1), never by more than `maxGain`. Never attenuates. */
export function normalizePeak(samples: Int16Array, targetPeak = 0.9, maxGain = 4): Int16Array {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  if (peak === 0) return samples.slice();
  const gain = Math.min(maxGain, (targetPeak * 32767) / peak);
  if (gain <= 1) return samples.slice();
  return samples.map((s) => Math.max(-32768, Math.min(32767, Math.round(s * gain))));
}

// --- IMA ADPCM -------------------------------------------------------------

const STEP_TABLE = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107,
  118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
  1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894,
  6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
  32767,
];
const INDEX_TABLE = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];

interface AdpcmState {
  predictor: number;
  index: number;
}

/** Applies one 4-bit code to the state and returns the new sample (same maths as the decoder). */
function step(state: AdpcmState, code: number): number {
  const stepSize = STEP_TABLE[state.index] ?? 7;
  let diff = stepSize >> 3;
  if (code & 4) diff += stepSize;
  if (code & 2) diff += stepSize >> 1;
  if (code & 1) diff += stepSize >> 2;
  state.predictor += code & 8 ? -diff : diff;
  state.predictor = Math.max(-32768, Math.min(32767, state.predictor));
  state.index = Math.max(0, Math.min(88, state.index + (INDEX_TABLE[code] ?? 0)));
  return state.predictor;
}

function encodeSample(state: AdpcmState, sample: number): number {
  const stepSize = STEP_TABLE[state.index] ?? 7;
  let diff = sample - state.predictor;
  let code = 0;
  if (diff < 0) {
    code = 8;
    diff = -diff;
  }
  if (diff >= stepSize) {
    code |= 4;
    diff -= stepSize;
  }
  if (diff >= stepSize >> 1) {
    code |= 2;
    diff -= stepSize >> 1;
  }
  if (diff >= stepSize >> 2) code |= 1;
  step(state, code);
  return code;
}

/**
 * Encodes one continuous stream. The state starts at predictor 0 / index 0
 * (the decoder resets to the same at every `audio_start`). Two samples per
 * byte, first sample in the low nibble.
 */
export function encodeImaAdpcm(samples: Int16Array): Uint8Array {
  const state: AdpcmState = { predictor: 0, index: 0 };
  const out = new Uint8Array(Math.ceil(samples.length / 2));
  for (let i = 0; i < samples.length; i += 2) {
    const low = encodeSample(state, samples[i] ?? 0);
    const high = i + 1 < samples.length ? encodeSample(state, samples[i + 1] ?? 0) : 0;
    out[i >> 1] = low | (high << 4);
  }
  return out;
}

/** Reference decoder (mirrors the firmware); used by tests. */
export function decodeImaAdpcm(bytes: Uint8Array, sampleCount = bytes.length * 2): Int16Array {
  const state: AdpcmState = { predictor: 0, index: 0 };
  const out = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const byte = bytes[i >> 1] ?? 0;
    out[i] = step(state, i % 2 === 0 ? byte & 0x0f : byte >> 4);
  }
  return out;
}
