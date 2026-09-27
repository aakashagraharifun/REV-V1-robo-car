/**
 * Movement commands the car understands. This list is the single source of
 * truth for what the validator accepts — anything else is rejected.
 */
export const MOVEMENT_COMMANDS = ['forward', 'backward', 'left', 'right', 'stop'] as const;
export type MovementCommand = (typeof MOVEMENT_COMMANDS)[number];

/** Where a command came from. Used for logging and safety rules. */
export type CommandSource = 'manual' | 'voice' | 'ai' | 'safety';

/** A validated, ready-to-send car command. */
export interface CarCommand {
  command: MovementCommand;
  /** 0–100, already clamped to the active safety limit. Always 0 for `stop`. */
  speed: number;
  /** When set, the app stops the car automatically after this many ms. */
  durationMs?: number;
  source: CommandSource;
}

export type CarMotionState = 'idle' | 'moving' | 'stopped' | 'error';

export interface CarStatus {
  state: CarMotionState;
  command: MovementCommand | null;
  speed: number;
  /** Battery percentage if the firmware reports it. */
  battery: number | null;
  /** Epoch ms of the last status update. */
  updatedAt: number;
  /** `device` = reported by the ESP32, `demo` = simulated by Mock Car Mode. */
  origin: 'device' | 'demo';
}

/** Result type used by validators and services that can fail without throwing. */
export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };
