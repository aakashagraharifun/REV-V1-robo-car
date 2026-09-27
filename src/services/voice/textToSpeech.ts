/**
 * Text-to-speech behind an interface. V1 uses the phone's built-in voice
 * (expo-speech). To use an external voice API later, implement
 * TextToSpeechEngine and pass it to AudioService.
 */
import * as Speech from 'expo-speech';

export interface SpeakOptions {
  language: string;
  rate: number;
  pitch: number;
}

export interface TextToSpeechEngine {
  /** Resolves when speech finishes or is stopped. */
  speak(text: string, options: SpeakOptions): Promise<void>;
  stop(): Promise<void>;
}

export class TextToSpeechError extends Error {
  readonly userMessage = 'I couldn’t say that out loud, but you can read it above.';
  constructor(detail?: string) {
    super(detail ?? 'tts failed');
    this.name = 'TextToSpeechError';
  }
}

/** Removes things that sound bad when read aloud (emoji, markdown symbols). */
export function prepareForSpeech(text: string): string {
  return text
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/[*_#`>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

class ExpoSpeechEngine implements TextToSpeechEngine {
  speak(text: string, options: SpeakOptions): Promise<void> {
    const clean = prepareForSpeech(text).slice(0, Speech.maxSpeechInputLength);
    if (!clean) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      try {
        Speech.speak(clean, {
          language: options.language,
          rate: options.rate,
          pitch: options.pitch,
          onDone: () => resolve(),
          onStopped: () => resolve(),
          onError: (error) => reject(new TextToSpeechError(error.message)),
        });
      } catch (error) {
        reject(new TextToSpeechError(error instanceof Error ? error.message : undefined));
      }
    });
  }

  async stop(): Promise<void> {
    try {
      await Speech.stop();
    } catch {
      // nothing to stop
    }
  }
}

export const textToSpeech: TextToSpeechEngine = new ExpoSpeechEngine();
