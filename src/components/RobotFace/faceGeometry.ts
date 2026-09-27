/**
 * Face layout in OLED pixel coordinates (128 × 64, monochrome).
 *
 * The in-app preview draws with exactly these numbers so the ESP32 firmware
 * (e.g. U8g2 / Adafruit_SSD1306) can reproduce the same faces:
 *   drawRBox(x, y, w, h, r) for eyes, arcs/lines for mouths.
 */
export const OLED_WIDTH = 128;
export const OLED_HEIGHT = 64;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FACE = {
  leftEye: { x: 28, y: 14, w: 24, h: 24 } satisfies Box,
  rightEye: { x: 76, y: 14, w: 24, h: 24 } satisfies Box,
  eyeRadius: 6,
  mouth: { x: 44, y: 42, w: 40, h: 16 } satisfies Box,
  leftWave: { x: 4, y: 18, w: 14, h: 28 } satisfies Box,
  rightWave: { x: 110, y: 18, w: 14, h: 28 } satisfies Box,
  stroke: 3,
} as const;
