/**
 * Safety limits. The command validator enforces these for every command,
 * regardless of whether it came from the D-pad, voice, or the AI.
 */
export const SAFETY_CONFIG = {
  /** Absolute speed ceiling. The user-adjustable limit can never exceed this. */
  HARD_MAX_SPEED: 100,
  /** Default user speed limit (adjustable in Settings up to HARD_MAX_SPEED). */
  DEFAULT_SPEED_LIMIT: 80,
  /** Speed the Control screen starts at. */
  DEFAULT_SPEED: 60,
  /** Speed used for voice/AI commands that don't specify one. */
  DEFAULT_VOICE_SPEED: 50,

  /** Voice/AI moves always run for a bounded time. */
  DEFAULT_COMMAND_DURATION_MS: 2_000,
  MIN_COMMAND_DURATION_MS: 200,
  MAX_COMMAND_DURATION_MS: 5_000,

  /**
   * While the car should be moving, the app re-sends the current command at
   * this interval. The firmware is expected to stop the motors if it hears
   * nothing for FIRMWARE_WATCHDOG_MS (see docs/ESP32_PROTOCOL.md), so a
   * frozen app or a dropped link always ends in a stop.
   */
  KEEPALIVE_INTERVAL_MS: 300,
  FIRMWARE_WATCHDOG_MS: 1_000,
} as const;
