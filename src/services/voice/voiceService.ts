/**
 * Voice state machine: IDLE → LISTENING → PROCESSING → SPEAKING → IDLE,
 * with ERROR on failures (auto-clears). Owns the microphone flow and
 * delegates speaking to AudioService so speech and sounds share one queue.
 */
import type { SpeechErrorCode, VoiceSettings, VoiceState } from '@/types/voice';
import { audioService } from '@/services/audio/audioService';
import { Emitter } from '@/utils/emitter';
import { createLogger } from '@/utils/logger';
import { SpeechError, speechToText, type SpeechToTextEngine } from './speechToText';
import { TextToSpeechError } from './textToSpeech';

const log = createLogger('Voice');
const ERROR_DISPLAY_MS = 3_000;

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  autoSpeak: true,
  language: 'en-US',
  rate: 1.0,
  pitch: 1.1,
};

export type ListenOutcome =
  | { kind: 'heard'; text: string }
  /** Nothing (or only silence) was heard. */
  | { kind: 'silence' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; code: SpeechErrorCode };

export interface VoiceSnapshot {
  state: VoiceState;
  error: string | null;
}

class VoiceService {
  private state: VoiceState = 'idle';
  private errorTimer: ReturnType<typeof setTimeout> | null = null;
  settings: VoiceSettings = { ...DEFAULT_VOICE_SETTINGS };

  readonly changes = new Emitter<VoiceSnapshot>();
  /** Live transcript while the user is still talking. */
  readonly partialTranscript = new Emitter<string>();

  constructor(private readonly stt: SpeechToTextEngine) {}

  get current(): VoiceState {
    return this.state;
  }

  isRecognitionAvailable(): boolean {
    return this.stt.isAvailable();
  }

  /**
   * Listens for one utterance. Errors are shown through `changes`.
   * `quiet` (hands-free): hearing nothing is not an error and the voice state
   * stays "listening" because the caller is about to listen again.
   */
  async listen({ quiet = false }: { quiet?: boolean } = {}): Promise<ListenOutcome> {
    audioService.stopAll(); // don't record Robo's own voice

    if (!this.stt.isAvailable()) return this.failWith('unavailable');
    if (!(await this.stt.requestPermission())) return this.failWith('permission_denied');

    this.setState('listening');
    this.partialTranscript.emit('');
    try {
      const text = await this.stt.listen({
        language: this.settings.language,
        onPartial: (partial) => this.partialTranscript.emit(partial),
      });
      this.partialTranscript.emit('');
      if (!text) return this.nothingHeard(quiet);
      this.setState('processing');
      return { kind: 'heard', text };
    } catch (error) {
      this.partialTranscript.emit('');
      const code = error instanceof SpeechError ? error.code : 'unknown';
      if (code === 'cancelled') {
        this.setState('idle');
        return { kind: 'cancelled' };
      }
      if (code === 'no_speech') return this.nothingHeard(quiet);
      log.warn('Listening failed', error);
      return this.failWith(code);
    }
  }

  /** Stops listening and keeps what was heard so far. */
  finishListening(): void {
    if (this.state === 'listening') this.stt.stop();
  }

  markProcessing(): void {
    this.setState('processing');
  }

  markIdle(): void {
    if (this.state !== 'error') this.setState('idle');
  }

  /** Speaks text (queued with sound effects). TTS failures surface as a voice error, never a crash. */
  async speak(text: string): Promise<void> {
    this.setState('speaking');
    try {
      await audioService.speak(text, {
        language: this.settings.language,
        rate: this.settings.rate,
        pitch: this.settings.pitch,
      });
      this.markIdle();
    } catch (error) {
      log.warn('TTS failed', error);
      this.fail(error instanceof TextToSpeechError ? error.userMessage : 'I couldn’t speak just now.');
    }
  }

  /** Cancels listening and speaking. */
  cancel(): void {
    this.stt.cancel();
    audioService.stopAll();
    this.clearError();
    this.setState('idle');
  }

  private nothingHeard(quiet: boolean): ListenOutcome {
    if (!quiet) this.fail(new SpeechError('no_speech').userMessage);
    return { kind: 'silence' };
  }

  private failWith(code: SpeechErrorCode): ListenOutcome {
    this.fail(new SpeechError(code).userMessage);
    return { kind: 'failed', code };
  }

  fail(message: string): void {
    this.clearError();
    this.setState('error', message);
    this.errorTimer = setTimeout(() => {
      this.errorTimer = null;
      if (this.state === 'error') this.setState('idle');
    }, ERROR_DISPLAY_MS);
  }

  private clearError(): void {
    if (this.errorTimer) clearTimeout(this.errorTimer);
    this.errorTimer = null;
  }

  private setState(state: VoiceState, error: string | null = null): void {
    if (state !== 'error') this.clearError();
    this.state = state;
    this.changes.emit({ state, error });
  }
}

export const voiceService = new VoiceService(speechToText);
