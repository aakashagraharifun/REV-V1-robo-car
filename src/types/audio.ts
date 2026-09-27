export const SOUND_IDS = ['cow', 'dog', 'cat', 'lion', 'robot', 'laugh', 'beep'] as const;
export type SoundId = (typeof SOUND_IDS)[number];

export interface SoundRequest {
  sound: SoundId;
}

/** Where audio is played: the phone speaker, or the car's speaker (ESP32 → I2S amp) streamed over BLE. */
export type AudioOutputTarget = 'phone' | 'esp32';
