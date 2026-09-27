/**
 * Speech-to-text behind an interface. V1 uses the phone's speech recognizer
 * through expo-speech-recognition, which needs a development build/APK — in
 * Expo Go the module is missing and `isAvailable()` returns false (typing
 * still works).
 */
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { SpeechErrorCode } from '@/types/voice';
import { createLogger } from '@/utils/logger';

const log = createLogger('STT');

/**
 * Recognition services known to work through Android's SpeechRecognizer API,
 * best first. Vendor defaults (e.g. Samsung Bixby) often return no results.
 */
const PREFERRED_ANDROID_SERVICES = ['com.google.android.googlequicksearchbox', 'com.google.android.tts', 'com.google.android.as'];

type SpeechModule = typeof import('expo-speech-recognition')['ExpoSpeechRecognitionModule'];

export interface ListenOptions {
  language: string;
  onPartial?: (text: string) => void;
}

export interface SpeechToTextEngine {
  isAvailable(): boolean;
  requestPermission(): Promise<boolean>;
  /** Listens for one utterance and resolves with the transcript ('' if nothing was heard). */
  listen(options: ListenOptions): Promise<string>;
  /** Stop listening and keep what was heard so far. */
  stop(): void;
  /** Stop listening and discard. */
  cancel(): void;
}

const USER_MESSAGES: Record<SpeechErrorCode, string> = {
  unavailable: 'Voice input isn’t available on this phone/build. You can type instead.',
  permission_denied: 'Microphone permission is off. Allow it in Android settings to talk to me.',
  no_speech: 'I didn’t hear anything. Tap the mic and try again.',
  network: 'Speech recognition needs internet on this phone. Check your connection.',
  busy: 'The microphone is busy. Try again in a moment.',
  cancelled: 'Listening cancelled.',
  unknown: 'I couldn’t understand that. Try again.',
};

export class SpeechError extends Error {
  readonly userMessage: string;
  constructor(
    readonly code: SpeechErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'SpeechError';
    this.userMessage = USER_MESSAGES[code];
  }
}

function mapErrorCode(code: string): SpeechErrorCode {
  switch (code) {
    case 'not-allowed':
      return 'permission_denied';
    case 'no-speech':
    case 'speech-timeout':
      return 'no_speech';
    case 'network':
      return 'network';
    case 'busy':
    case 'audio-capture':
      return 'busy';
    case 'aborted':
      return 'cancelled';
    case 'service-not-allowed':
    case 'language-not-supported':
      return 'unavailable';
    default:
      return 'unknown';
  }
}

function loadModule(): SpeechModule | null {
  // Probe first: requiring the package when the native module is missing
  // (Expo Go, web) makes it throw and show a red error overlay in development.
  if (!requireOptionalNativeModule('ExpoSpeechRecognition')) {
    log.info('Speech recognition unavailable in this build (Expo Go/web) — typing still works.');
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-speech-recognition') as typeof import('expo-speech-recognition');
    return mod.ExpoSpeechRecognitionModule;
  } catch (error) {
    log.info('Speech recognition native module not available', error);
    return null;
  }
}

class ExpoSpeechToText implements SpeechToTextEngine {
  private module: SpeechModule | null | undefined;
  private active = false;
  private servicePackage: string | null | undefined;

  private get mod(): SpeechModule | null {
    if (this.module === undefined) this.module = loadModule();
    return this.module;
  }

  isAvailable(): boolean {
    const mod = this.mod;
    if (!mod) return false;
    try {
      return mod.isRecognitionAvailable();
    } catch {
      return false;
    }
  }

  async requestPermission(): Promise<boolean> {
    const mod = this.mod;
    if (!mod) return false;
    try {
      const result = await mod.requestPermissionsAsync();
      return result.granted;
    } catch {
      return false;
    }
  }

  /** Google's recognizer when the default one is something else; undefined = use the default. */
  private androidService(mod: SpeechModule): string | undefined {
    if (Platform.OS !== 'android') return undefined;
    if (this.servicePackage === undefined) {
      this.servicePackage = null;
      try {
        const current = mod.getDefaultRecognitionService().packageName;
        const installed = mod.getSpeechRecognitionServices();
        if (!PREFERRED_ANDROID_SERVICES.includes(current)) {
          this.servicePackage = PREFERRED_ANDROID_SERVICES.find((p) => installed.includes(p)) ?? null;
        }
        log.info('Recognition service', { default: current || 'none', using: this.servicePackage ?? current });
      } catch (error) {
        log.debug('Could not query recognition services', error);
      }
    }
    return this.servicePackage ?? undefined;
  }

  listen({ language, onPartial }: ListenOptions): Promise<string> {
    const mod = this.mod;
    if (!mod) return Promise.reject(new SpeechError('unavailable'));
    if (this.active) mod.abort();

    return new Promise<string>((resolve, reject) => {
      let finalText = '';
      let latestText = '';
      let failed: SpeechError | null = null;

      const subs = [
        mod.addListener('result', (event) => {
          const text = event.results[0]?.transcript ?? '';
          latestText = text;
          if (event.isFinal) finalText = text;
          else onPartial?.(text);
        }),
        mod.addListener('error', (event) => {
          failed = new SpeechError(mapErrorCode(event.error), event.message);
        }),
        mod.addListener('end', () => {
          subs.forEach((s) => s.remove());
          this.active = false;
          const text = (finalText || latestText).trim();
          // "no speech" with a partial transcript is still a usable result.
          if (failed && !(failed.code === 'no_speech' && text)) reject(failed);
          else resolve(text);
        }),
      ];

      try {
        this.active = true;
        mod.start({
          lang: language,
          interimResults: true,
          continuous: false,
          maxAlternatives: 1,
          androidRecognitionServicePackage: this.androidService(mod),
        });
      } catch (error) {
        subs.forEach((s) => s.remove());
        this.active = false;
        reject(new SpeechError('unknown', error instanceof Error ? error.message : undefined));
      }
    });
  }

  stop(): void {
    if (this.active) this.mod?.stop();
  }

  cancel(): void {
    if (this.active) this.mod?.abort();
  }
}

export const speechToText: SpeechToTextEngine = new ExpoSpeechToText();
