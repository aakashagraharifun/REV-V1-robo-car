/**
 * Plays audio on the car's own speaker (ESP32 → I2S → MAX98357A).
 *
 *   PCM (any rate) → 16 kHz → IMA ADPCM (8 KB/s) → audio_start → chunks on the
 *   audio characteristic → audio_end
 *
 * Sending is paced to playback speed so the phone never gets more than
 * AUDIO_MAX_LEAD_MS ahead — the firmware's buffer only needs to hold that
 * much plus the prebuffer. The phone can't hear the car, so "finished" is
 * estimated from the clip length.
 */
import { BLE_CONFIG } from '@/config/bleConfig';
import { bluetoothManager } from '@/services/bluetooth/bluetoothManager';
import { sleep } from '@/utils/async';
import { createLogger } from '@/utils/logger';
import { encodeImaAdpcm, normalizePeak, resample } from './pcm';
import type { DecodedAudio } from './wav';

const log = createLogger('CarSpeaker');
const BYTES_PER_SECOND = BLE_CONFIG.AUDIO_SAMPLE_RATE / 2; // two 4-bit samples per byte
const LEAD_BYTES = (BLE_CONFIG.AUDIO_MAX_LEAD_MS / 1000) * BYTES_PER_SECOND;
const PREBUFFER_BYTES = (BLE_CONFIG.AUDIO_PREBUFFER_MS / 1000) * BYTES_PER_SECOND;
/** Extra wait after the estimated end, for BLE latency and the I2S DMA buffer. */
const END_MARGIN_MS = 250;
const MIN_CHUNK = 20;

export interface CarClip {
  /** Samples at BLE_CONFIG.AUDIO_SAMPLE_RATE. */
  samples: number;
  /** IMA ADPCM bytes. */
  bytes: Uint8Array;
  durationMs: number;
}

/** Converts decoded audio into what the firmware plays. */
export function prepareCarClip(audio: DecodedAudio): CarClip {
  const pcm = normalizePeak(resample(audio.samples, audio.sampleRate, BLE_CONFIG.AUDIO_SAMPLE_RATE));
  return {
    samples: pcm.length,
    bytes: encodeImaAdpcm(pcm),
    durationMs: (pcm.length / BLE_CONFIG.AUDIO_SAMPLE_RATE) * 1000,
  };
}

/** Waits `ms`, returning early if `signal` aborts. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done);
  });
}

/**
 * Streams a clip to the car and resolves when it should have finished playing.
 * Aborting stops the car speaker. Throws a BluetoothError if the link fails.
 */
export async function playOnCar(clip: CarClip, signal: AbortSignal): Promise<void> {
  if (clip.bytes.length === 0 || signal.aborted) return;
  const chunkSize = Math.max(MIN_CHUNK, bluetoothManager.maxAudioChunkSize);

  try {
    await bluetoothManager.sendAudioStart(clip.samples, clip.bytes.length);
    const started = Date.now();
    let playbackStarted: number | null = null;
    let sent = 0;

    while (sent < clip.bytes.length) {
      if (signal.aborted) break;
      const allowed = LEAD_BYTES + ((Date.now() - started) / 1000) * BYTES_PER_SECOND;
      if (sent >= allowed) {
        await sleep(Math.min(50, ((sent - allowed) / BYTES_PER_SECOND) * 1000 + 5));
        continue;
      }
      const chunk = clip.bytes.subarray(sent, sent + chunkSize);
      await bluetoothManager.sendAudio(chunk);
      sent += chunk.length;
      if (playbackStarted === null && sent >= PREBUFFER_BYTES) playbackStarted = Date.now();
    }

    if (!signal.aborted) {
      await bluetoothManager.sendAudioEnd();
      const sentAll = Date.now();
      // If BLE was slower than playback the car rebuffered, so it can't finish
      // before the last bytes arrived and were played.
      const end = Math.max((playbackStarted ?? sentAll) + clip.durationMs, sentAll + BLE_CONFIG.AUDIO_PREBUFFER_MS);
      await wait(end + END_MARGIN_MS - Date.now(), signal);
    }
  } catch (error) {
    if (!signal.aborted) throw error;
  }

  if (signal.aborted) {
    bluetoothManager.sendAudioStop().catch((error: unknown) => log.debug('audio_stop failed', error));
  }
}
