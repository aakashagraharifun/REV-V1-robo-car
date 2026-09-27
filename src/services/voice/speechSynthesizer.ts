/**
 * Turns text into audio samples (instead of playing it) so Robo's voice can
 * be streamed to the car speaker. Uses the local native module
 * modules/robo-tts (Android TextToSpeech.synthesizeToFile) — the same voice
 * the phone speaks with. Missing in Expo Go/web: `isAvailable()` is false and
 * speech falls back to the phone speaker.
 */
import { File } from 'expo-file-system';

import RoboTts from '../../../modules/robo-tts';
import { parseWav, type DecodedAudio } from '@/services/audio/wav';
import { createLogger } from '@/utils/logger';
import { withTimeout } from '@/utils/async';
import { prepareForSpeech, type SpeakOptions } from './textToSpeech';

const log = createLogger('Synth');
const SYNTH_TIMEOUT_MS = 15_000;
/** Android's TextToSpeech input limit. */
const MAX_INPUT_LENGTH = 3_900;

export class SynthesisError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'SynthesisError';
  }
}

export interface SpeechSynthesizer {
  isAvailable(): boolean;
  /** Resolves with mono samples, or null when there is nothing to say. */
  synthesize(text: string, options: SpeakOptions): Promise<DecodedAudio | null>;
}

class NativeSpeechSynthesizer implements SpeechSynthesizer {
  isAvailable(): boolean {
    return RoboTts !== null;
  }

  async synthesize(text: string, options: SpeakOptions): Promise<DecodedAudio | null> {
    if (!RoboTts) throw new SynthesisError('robo-tts native module missing (Expo Go?)');
    const clean = prepareForSpeech(text).slice(0, MAX_INPUT_LENGTH);
    if (!clean) return null;

    const uri = await withTimeout(
      RoboTts.synthesizeToFile(clean, { language: options.language, rate: options.rate, pitch: options.pitch }),
      SYNTH_TIMEOUT_MS,
      () => new SynthesisError('speech synthesis timed out'),
    );
    const file = new File(uri);
    try {
      return parseWav(await file.bytes());
    } finally {
      try {
        file.delete();
      } catch (error) {
        log.debug('Could not delete synthesized file', error);
      }
    }
  }
}

export const speechSynthesizer: SpeechSynthesizer = new NativeSpeechSynthesizer();
