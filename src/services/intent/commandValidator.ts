/**
 * The safety gate. Every car command — from the D-pad, voice rules or the AI —
 * passes through here before anything is sent to the ESP32. Invalid commands
 * are rejected, never "fixed up" into something the user didn't ask for.
 * The only adjustment made is clamping speed down to the user's speed limit.
 */
import { SAFETY_CONFIG } from '@/config/safetyConfig';
import { SOUND_IDS, type SoundId } from '@/types/audio';
import { MOVEMENT_COMMANDS, type CarCommand, type CommandSource, type MovementCommand, type Result } from '@/types/commands';
import { INTENT_TYPES, type RawIntent } from './intentTypes';

export interface CommandValidationContext {
  source: CommandSource;
  /** User speed limit from Settings (0–HARD_MAX_SPEED). */
  speedLimit: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Accepts numbers and numeric strings ("60"); anything else is null. */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value);
  return null;
}

export function isMovementCommand(value: unknown): value is MovementCommand {
  return typeof value === 'string' && MOVEMENT_COMMANDS.some((c) => c === value);
}

export function effectiveSpeedLimit(limit: number): number {
  return Math.max(0, Math.min(SAFETY_CONFIG.HARD_MAX_SPEED, Math.round(limit)));
}

export function validateCarCommand(raw: unknown, ctx: CommandValidationContext): Result<CarCommand> {
  if (!isRecord(raw)) return { ok: false, error: 'Command must be an object.' };

  const name = typeof raw.command === 'string' ? raw.command.trim().toLowerCase() : raw.command;
  if (!isMovementCommand(name)) {
    return { ok: false, error: `Unknown command. Allowed: ${MOVEMENT_COMMANDS.join(', ')}.` };
  }

  if (name === 'stop') return { ok: true, value: { command: 'stop', speed: 0, source: ctx.source } };

  // Speed ------------------------------------------------------------------
  const isAutomated = ctx.source === 'voice' || ctx.source === 'ai';
  let speed: number;
  if (raw.speed === undefined || raw.speed === null) {
    if (!isAutomated) return { ok: false, error: 'Speed is required.' };
    speed = SAFETY_CONFIG.DEFAULT_VOICE_SPEED;
  } else {
    const parsed = toNumber(raw.speed);
    if (parsed === null || parsed < 0 || parsed > SAFETY_CONFIG.HARD_MAX_SPEED) {
      return { ok: false, error: `Speed must be between 0 and ${SAFETY_CONFIG.HARD_MAX_SPEED}.` };
    }
    speed = parsed;
  }
  speed = Math.min(Math.round(speed), effectiveSpeedLimit(ctx.speedLimit));

  // Duration ---------------------------------------------------------------
  // Voice/AI moves are always time-limited. Manual D-pad moves are
  // hold-to-drive (no duration) and rely on keep-alives + firmware watchdog.
  let durationMs: number | undefined;
  if (raw.duration === undefined || raw.duration === null) {
    durationMs = isAutomated ? SAFETY_CONFIG.DEFAULT_COMMAND_DURATION_MS : undefined;
  } else {
    const parsed = toNumber(raw.duration);
    if (
      parsed === null ||
      parsed < SAFETY_CONFIG.MIN_COMMAND_DURATION_MS ||
      parsed > SAFETY_CONFIG.MAX_COMMAND_DURATION_MS
    ) {
      return {
        ok: false,
        error: `I can only drive for ${SAFETY_CONFIG.MIN_COMMAND_DURATION_MS / 1000}–${SAFETY_CONFIG.MAX_COMMAND_DURATION_MS / 1000} seconds at a time.`,
      };
    }
    durationMs = Math.round(parsed);
  }

  return { ok: true, value: { command: name, speed, durationMs, source: ctx.source } };
}

export function validateSound(raw: unknown): Result<SoundId> {
  const name = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  const sound = SOUND_IDS.find((s) => s === name);
  return sound ? { ok: true, value: sound } : { ok: false, error: `I know these sounds: ${SOUND_IDS.join(', ')}.` };
}

/**
 * Extracts the first JSON object from model output (tolerating code fences or
 * stray prose) and checks it has a known `intent`. Field values are validated
 * later by the functions above.
 */
export function parseRawIntent(text: string): Result<RawIntent> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return { ok: false, error: 'No JSON object found.' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { ok: false, error: 'Invalid JSON.' };
  }
  if (!isRecord(parsed)) return { ok: false, error: 'JSON is not an object.' };

  const intent = typeof parsed.intent === 'string' ? parsed.intent.trim().toUpperCase() : '';
  const known = INTENT_TYPES.find((t) => t === intent);
  if (!known) return { ok: false, error: `Unknown intent "${intent}".` };

  return {
    ok: true,
    value: {
      intent: known,
      command: parsed.command,
      speed: parsed.speed,
      duration: parsed.duration,
      sound: parsed.sound,
      response: parsed.response,
    },
  };
}

/** Cleans a model reply for display/speech: strings only, bounded length. */
export function sanitizeResponse(value: unknown, maxLength = 1200): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/```[\s\S]*?```/g, '').trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
