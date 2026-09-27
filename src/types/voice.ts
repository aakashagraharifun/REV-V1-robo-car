export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

export interface VoiceSettings {
  /** Speak Robo's replies out loud. */
  autoSpeak: boolean;
  /** BCP-47 language tag for both recognition and speech, e.g. "en-US". */
  language: string;
  /** 0.5–2.0, 1.0 = normal. */
  rate: number;
  /** 0.5–2.0, 1.0 = normal. */
  pitch: number;
}

export type SpeechErrorCode =
  | 'unavailable'
  | 'permission_denied'
  | 'no_speech'
  | 'network'
  | 'busy'
  | 'cancelled'
  | 'unknown';
