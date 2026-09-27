/**
 * Simulated ESP32 used in Demo Mode (Mock Car Mode).
 *
 * It behaves like the real firmware is expected to: it receives the same
 * encoded bytes, parses them with the same protocol, replies with status
 * frames, and enforces the same motor watchdog. That way the entire command
 * path — validation, encoding, keep-alives, status parsing — is exercised
 * without hardware.
 */
import { SAFETY_CONFIG } from '@/config/safetyConfig';
import type { MovementCommand } from '@/types/commands';
import type { OLEDState } from '@/types/oled';
import { Emitter } from '@/utils/emitter';
import { utf8Decode } from '@/utils/encoding';
import {
  encodeStatus,
  isOLEDState,
  type ReportedCarState,
  type StatusMessage,
} from './bleProtocol';

const SIMULATED_LATENCY_MS = 40;

class MockCar {
  private buffer = '';
  private state: ReportedCarState = 'idle';
  private command: MovementCommand | null = null;
  private speed = 0;
  private battery = 87;
  private watchdog: ReturnType<typeof setTimeout> | null = null;

  /** Encoded status frames, exactly as the real car would notify them. */
  readonly notifications = new Emitter<Uint8Array>();
  /** Last OLED state received — handy for debugging. */
  oledState: OLEDState = 'idle';

  /** Accepts bytes written to the command characteristic. */
  receive(bytes: Uint8Array): void {
    this.buffer += utf8Decode(bytes);
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const frame = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      this.handleFrame(frame);
      newline = this.buffer.indexOf('\n');
    }
  }

  reset(): void {
    this.clearWatchdog();
    this.buffer = '';
    this.state = 'idle';
    this.command = null;
    this.speed = 0;
  }

  private handleFrame(frame: string): void {
    let message: unknown;
    try {
      message = JSON.parse(frame);
    } catch {
      this.notify('error', 'bad json');
      return;
    }
    if (typeof message !== 'object' || message === null) return;
    const msg = message as Record<string, unknown>;

    if (msg.type === 'car_command') {
      this.handleCarCommand(msg.command, msg.speed);
    } else if (msg.type === 'oled' && isOLEDState(msg.state)) {
      this.oledState = msg.state;
    }
  }

  private handleCarCommand(command: unknown, speed: unknown): void {
    // The firmware must re-validate too — never trust the radio link.
    if (command === 'stop') {
      this.stopMotors('stopped');
      return;
    }
    if (command !== 'forward' && command !== 'backward' && command !== 'left' && command !== 'right') {
      this.notify('error', 'unknown command');
      return;
    }
    if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0 || speed > 100) {
      this.notify('error', 'bad speed');
      return;
    }
    const changed = this.command !== command || this.speed !== speed || this.state !== 'moving';
    this.state = 'moving';
    this.command = command;
    this.speed = speed;
    this.battery = Math.max(5, this.battery - 0.01);
    this.armWatchdog();
    // Keep-alives repeat the same command; only report actual changes.
    if (changed) this.notify('moving');
  }

  private armWatchdog(): void {
    this.clearWatchdog();
    this.watchdog = setTimeout(() => this.stopMotors('stopped', 'watchdog'), SAFETY_CONFIG.FIRMWARE_WATCHDOG_MS);
  }

  private clearWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  private stopMotors(state: ReportedCarState, message?: string): void {
    this.clearWatchdog();
    this.state = state;
    this.command = 'stop';
    this.speed = 0;
    this.notify(state, message);
  }

  private notify(state: ReportedCarState, message?: string): void {
    const status: StatusMessage = {
      type: 'status',
      state,
      command: this.command,
      speed: this.speed,
      battery: Math.round(this.battery),
      message: message ?? null,
    };
    const bytes = encodeStatus(status);
    setTimeout(() => this.notifications.emit(bytes), SIMULATED_LATENCY_MS);
  }
}

export const mockCar = new MockCar();
