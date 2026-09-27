/**
 * Plays everything Robo "says": sound effects and synthesized speech.
 *
 * Output is chosen per clip:
 *   - 'esp32' (car speaker) when the user picked it AND a real car with an
 *     audio characteristic is connected: audio is decoded/synthesized on the
 *     phone and streamed over BLE (carSpeaker.ts).
 *   - otherwise the phone speaker.
 * If the car path fails mid-way (link lost, native module missing) the clip
 * falls back to the phone so Robo is never silently mute.
 */
import { Asset } from 'expo-asset';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { File } from 'expo-file-system';

import type { AudioOutputTarget, SoundId } from '@/types/audio';
import { bluetoothManager } from '@/services/bluetooth/bluetoothManager';
import { speechSynthesizer, type SpeechSynthesizer } from '@/services/voice/speechSynthesizer';
import { textToSpeech, type SpeakOptions, type TextToSpeechEngine } from '@/services/voice/textToSpeech';
import { Emitter } from '@/utils/emitter';
import { createLogger } from '@/utils/logger';
import { AudioQueue, type AudioJobKind } from './audioQueue';
import { playOnCar, prepareCarClip, type CarClip } from './carSpeaker';
import { SOUND_LIBRARY } from './soundLibrary';
import { parseWav } from './wav';

const log = createLogger('Audio');
/** Upper bound on a clip in case the "finished" event never arrives. */
const MAX_CLIP_MS = 10_000;

export class AudioError extends Error {
  readonly userMessage: string;
  constructor(userMessage: string, detail?: string) {
    super(detail ?? userMessage);
    this.name = 'AudioError';
    this.userMessage = userMessage;
  }
}

function playClip(source: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let player: AudioPlayer;
    try {
      player = createAudioPlayer(source);
    } catch (error) {
      reject(new AudioError('I couldn’t play that sound.', String(error)));
      return;
    }

    let done = false;
    const finish = (error?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      subscription.remove();
      signal.removeEventListener('abort', onAbort);
      try {
        player.remove();
      } catch {
        // already released
      }
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => {
      try {
        player.pause();
      } catch {
        // ignore
      }
      finish();
    };

    const subscription = player.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish) finish();
    });
    const timer = setTimeout(() => finish(), MAX_CLIP_MS);
    signal.addEventListener('abort', onAbort);

    try {
      player.play();
    } catch (error) {
      finish(new AudioError('I couldn’t play that sound.', String(error)));
    }
  });
}

/** Reads a bundled WAV clip and converts it to the car's audio format. */
async function loadCarClip(source: number): Promise<CarClip> {
  const asset = Asset.fromModule(source);
  await asset.downloadAsync(); // copies the APK resource / dev-server file to a readable cache file
  const bytes = await new File(asset.localUri ?? asset.uri).bytes();
  return prepareCarClip(parseWav(bytes));
}

class AudioService {
  private readonly queue = new AudioQueue();
  private readonly carClips = new Map<SoundId, Promise<CarClip>>();
  private modeConfigured = false;
  private preferredOutput: AudioOutputTarget = 'phone';

  /** 'speech' | 'sound' while playing, null when idle. */
  readonly activity = new Emitter<AudioJobKind | null>();

  constructor(
    private readonly tts: TextToSpeechEngine,
    private readonly synthesizer: SpeechSynthesizer,
  ) {
    this.queue.onActivity = (kind) => this.activity.emit(kind);
  }

  get isBusy(): boolean {
    return this.queue.isBusy;
  }

  /** Where the user wants Robo's voice and sounds (Settings). */
  setPreferredOutput(output: AudioOutputTarget): void {
    this.preferredOutput = output;
  }

  /** Where audio will play right now. */
  get output(): AudioOutputTarget {
    return this.preferredOutput === 'esp32' && bluetoothManager.canPlayAudioOnCar() ? 'esp32' : 'phone';
  }

  async playSound(id: SoundId): Promise<void> {
    await this.ensureAudioMode();
    const sound = SOUND_LIBRARY[id];
    return this.queue.enqueue({
      kind: 'sound',
      run: async (signal) => {
        if (this.output === 'esp32') {
          try {
            await playOnCar(await this.carClip(id), signal);
            return;
          } catch (error) {
            if (signal.aborted) return;
            log.warn('Car speaker failed, playing on the phone', error);
          }
        }
        await playClip(sound.source, signal);
      },
    });
  }

  speak(text: string, options: SpeakOptions): Promise<void> {
    return this.queue.enqueue({
      kind: 'speech',
      run: async (signal) => {
        if (this.output === 'esp32' && this.synthesizer.isAvailable()) {
          try {
            const audio = await this.synthesizer.synthesize(text, options);
            if (audio && !signal.aborted) await playOnCar(prepareCarClip(audio), signal);
            return;
          } catch (error) {
            if (signal.aborted) return;
            log.warn('Car speaker speech failed, speaking on the phone', error);
          }
        }
        await this.speakOnPhone(text, options, signal);
      },
    });
  }

  /** Stops current playback (phone and car) and clears anything queued. */
  stopAll(): void {
    this.queue.clear();
    void this.tts.stop();
  }

  private async speakOnPhone(text: string, options: SpeakOptions, signal: AbortSignal): Promise<void> {
    const onAbort = () => void this.tts.stop();
    signal.addEventListener('abort', onAbort);
    try {
      await this.tts.speak(text, options);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  /** Decoded clips are cached; a failed load is retried next time. */
  private carClip(id: SoundId): Promise<CarClip> {
    let clip = this.carClips.get(id);
    if (!clip) {
      clip = loadCarClip(SOUND_LIBRARY[id].source);
      clip.catch(() => this.carClips.delete(id));
      this.carClips.set(id, clip);
    }
    return clip;
  }

  private async ensureAudioMode(): Promise<void> {
    if (this.modeConfigured) return;
    try {
      await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers' });
      this.modeConfigured = true;
    } catch (error) {
      log.warn('setAudioModeAsync failed', error);
    }
  }
}

export const audioService = new AudioService(textToSpeech, speechSynthesizer);
