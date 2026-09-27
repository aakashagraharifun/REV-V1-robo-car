/**
 * ESP32 wire protocol — the ONLY file that knows the message format.
 * Keep docs/ESP32_PROTOCOL.md in sync when changing anything here.
 *
 * Framing: each message is a UTF-8 JSON object followed by "\n". If a message
 * is longer than one BLE write allows, it is split into consecutive writes;
 * the firmware appends bytes to a buffer until it sees "\n", then parses.
 */
import { BLE_CONFIG } from '@/config/bleConfig';
import type { CarCommand, MovementCommand } from '@/types/commands';
import { MOVEMENT_COMMANDS } from '@/types/commands';
import type { OLEDState } from '@/types/oled';
import { OLED_STATES } from '@/types/oled';
import { utf8Decode, utf8Encode } from '@/utils/encoding';

/** v2 added the optional car-speaker audio messages. */
export const PROTOCOL_VERSION = 2;

// ---------------------------------------------------------------------------
// Phone → car
// ---------------------------------------------------------------------------

export type CarCommandMessage =
  | { type: 'car_command'; command: Exclude<MovementCommand, 'stop'>; speed: number }
  | { type: 'car_command'; command: 'stop' };

export interface OLEDMessage {
  type: 'oled';
  state: OLEDState;
}

/** Announces an audio clip; its bytes follow on the audio characteristic. */
export interface AudioStartMessage {
  type: 'audio_start';
  format: typeof BLE_CONFIG.AUDIO_FORMAT;
  sampleRate: number;
  /** Number of samples in the clip. */
  samples: number;
  /** Number of encoded bytes that will follow. */
  bytes: number;
}

/** All bytes of the clip have been sent; play out what's buffered. */
export interface AudioEndMessage {
  type: 'audio_end';
}

/** Stop playing immediately and drop anything buffered. */
export interface AudioStopMessage {
  type: 'audio_stop';
}

export type AudioControlMessage = AudioStartMessage | AudioEndMessage | AudioStopMessage;

export type OutgoingMessage = CarCommandMessage | OLEDMessage | AudioControlMessage;

export function buildCarCommandMessage(command: CarCommand): CarCommandMessage {
  if (command.command === 'stop') return { type: 'car_command', command: 'stop' };
  return { type: 'car_command', command: command.command, speed: Math.round(command.speed) };
}

export function buildOLEDMessage(state: OLEDState): OLEDMessage {
  return { type: 'oled', state };
}

export function buildAudioStartMessage(samples: number, bytes: number): AudioStartMessage {
  return {
    type: 'audio_start',
    format: BLE_CONFIG.AUDIO_FORMAT,
    sampleRate: BLE_CONFIG.AUDIO_SAMPLE_RATE,
    samples,
    bytes,
  };
}

export function encodeMessage(message: OutgoingMessage): Uint8Array {
  return utf8Encode(JSON.stringify(message) + BLE_CONFIG.MESSAGE_TERMINATOR);
}

/** Splits a frame into pieces of at most `maxChunkSize` bytes. */
export function chunkBytes(bytes: Uint8Array, maxChunkSize: number): Uint8Array[] {
  const size = Math.max(1, Math.floor(maxChunkSize));
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += size) {
    chunks.push(bytes.subarray(offset, offset + size));
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Car → phone
// ---------------------------------------------------------------------------

export type ReportedCarState = 'idle' | 'moving' | 'stopped' | 'error';

export interface StatusMessage {
  type: 'status';
  state: ReportedCarState;
  command: MovementCommand | null;
  speed: number;
  battery: number | null;
  message: string | null;
}

export type IncomingMessage = StatusMessage;

const REPORTED_STATES: readonly ReportedCarState[] = ['idle', 'moving', 'stopped', 'error'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Validates an incoming JSON object. Unknown or malformed messages return null. */
export function parseIncoming(value: unknown): IncomingMessage | null {
  if (!isRecord(value) || value.type !== 'status') return null;
  const state = REPORTED_STATES.find((s) => s === value.state);
  if (!state) return null;
  const command = MOVEMENT_COMMANDS.find((c) => c === value.command) ?? null;
  const speed = finiteNumber(value.speed);
  const battery = finiteNumber(value.battery);
  return {
    type: 'status',
    state,
    command,
    speed: speed === null ? 0 : Math.min(100, Math.max(0, speed)),
    battery: battery === null ? null : Math.min(100, Math.max(0, battery)),
    message: typeof value.message === 'string' ? value.message.slice(0, 120) : null,
  };
}

/** Serialises a status message (used by the simulated car in Mock Car Mode). */
export function encodeStatus(status: StatusMessage): Uint8Array {
  return utf8Encode(JSON.stringify(status) + BLE_CONFIG.MESSAGE_TERMINATOR);
}

/** Reassembles newline-terminated JSON frames from notification chunks. */
export class MessageDecoder {
  private buffer = '';
  private static readonly MAX_BUFFER = 2048;

  push(bytes: Uint8Array): IncomingMessage[] {
    this.buffer += utf8Decode(bytes);
    if (this.buffer.length > MessageDecoder.MAX_BUFFER) {
      // Garbage or a missing terminator — drop it rather than grow forever.
      this.buffer = '';
      return [];
    }
    const messages: IncomingMessage[] = [];
    let newline = this.buffer.indexOf(BLE_CONFIG.MESSAGE_TERMINATOR);
    while (newline !== -1) {
      const frame = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (frame.length > 0) {
        try {
          const parsed = parseIncoming(JSON.parse(frame));
          if (parsed) messages.push(parsed);
        } catch {
          // Malformed JSON from the firmware — ignore the frame.
        }
      }
      newline = this.buffer.indexOf(BLE_CONFIG.MESSAGE_TERMINATOR);
    }
    return messages;
  }

  reset(): void {
    this.buffer = '';
  }
}

export function isOLEDState(value: unknown): value is OLEDState {
  return OLED_STATES.some((s) => s === value);
}
