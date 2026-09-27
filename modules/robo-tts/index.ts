/**
 * Local native module (Android): renders text-to-speech into a WAV file
 * instead of playing it. Source: modules/robo-tts/android. It is autolinked
 * into development builds and APKs; in Expo Go, on web and on iOS it is
 * missing and the default export is null.
 */
import { requireOptionalNativeModule } from 'expo';

export interface SynthesisOptions {
  /** BCP-47 tag, e.g. "en-US". Falls back to the phone's language if no voice is installed. */
  language: string;
  /** 1.0 = normal. */
  rate: number;
  /** 1.0 = normal. */
  pitch: number;
}

interface RoboTtsModule {
  /** Resolves with a file:// URI of a mono PCM WAV. Delete it after reading. */
  synthesizeToFile(text: string, options: SynthesisOptions): Promise<string>;
}

const RoboTts = requireOptionalNativeModule<RoboTtsModule>('RoboTts');

export default RoboTts;
