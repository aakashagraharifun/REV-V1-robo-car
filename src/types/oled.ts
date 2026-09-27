/** Face states rendered by the ESP32 on its OLED (and previewed in the app). */
export const OLED_STATES = [
  'idle',
  'listening',
  'thinking',
  'speaking',
  'moving',
  'stopped',
  'error',
] as const;
export type OLEDState = (typeof OLED_STATES)[number];
