/**
 * Command abstraction between the UI/assistant and Bluetooth.
 *
 * - Accepts only validated CarCommands (or validates manual input itself).
 * - While moving, re-sends the command every KEEPALIVE_INTERVAL_MS so the
 *   firmware watchdog keeps the motors on; if the app stalls or the link
 *   drops, the keep-alives stop and the car stops by itself.
 * - Timed moves (voice/AI) stop automatically after `durationMs`.
 */
import { SAFETY_CONFIG } from '@/config/safetyConfig';
import type { CarCommand, CommandSource, MovementCommand } from '@/types/commands';
import { bluetoothManager } from '@/services/bluetooth/bluetoothManager';
import { toBluetoothError } from '@/services/bluetooth/bluetoothErrors';
import { validateCarCommand } from '@/services/intent/commandValidator';
import { Emitter } from '@/utils/emitter';
import { createLogger } from '@/utils/logger';

const log = createLogger('Car');
/** Skip a keep-alive if this many writes are still in flight (slow link). */
const MAX_PENDING_FOR_KEEPALIVE = 2;

class CarController {
  private active: CarCommand | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private durationTimer: ReturnType<typeof setTimeout> | null = null;
  private speedLimit: number = SAFETY_CONFIG.DEFAULT_SPEED_LIMIT;

  /** The command currently in effect (null = stopped). */
  readonly commandChanges = new Emitter<CarCommand | null>();
  /** Errors while sending (e.g. link lost mid-drive). */
  readonly errors = new Emitter<string>();

  get currentCommand(): CarCommand | null {
    return this.active;
  }

  setSpeedLimit(limit: number): void {
    this.speedLimit = limit;
  }

  /** Validates and starts a hold-to-drive move from the D-pad. */
  async driveManual(command: Exclude<MovementCommand, 'stop'>, speed: number): Promise<void> {
    const result = validateCarCommand({ command, speed }, { source: 'manual', speedLimit: this.speedLimit });
    if (!result.ok) throw new Error(result.error);
    await this.drive(result.value);
  }

  /** Changes speed of the move in progress (manual control slider). */
  async updateSpeed(speed: number): Promise<void> {
    const current = this.active;
    if (!current || current.source !== 'manual' || current.command === 'stop') return;
    const result = validateCarCommand({ command: current.command, speed }, { source: 'manual', speedLimit: this.speedLimit });
    if (!result.ok) return;
    this.active = result.value;
    this.commandChanges.emit(this.active);
    await this.send(this.active);
  }

  /** Executes an already-validated command. */
  async drive(command: CarCommand): Promise<void> {
    if (command.command === 'stop') return this.stop(command.source);

    this.clearTimers();
    this.active = command;
    this.commandChanges.emit(command);

    try {
      await bluetoothManager.sendCarCommand(command);
    } catch (error) {
      this.halt();
      throw toBluetoothError(error, 'write_failed');
    }
    // A stop may have arrived while the write was in flight.
    if (this.active !== command) return;

    this.keepAliveTimer = setInterval(() => {
      if (!this.active || bluetoothManager.pendingWrites > MAX_PENDING_FOR_KEEPALIVE) return;
      this.send(this.active).catch(() => undefined);
    }, SAFETY_CONFIG.KEEPALIVE_INTERVAL_MS);

    if (command.durationMs !== undefined) {
      this.durationTimer = setTimeout(() => {
        void this.stop(command.source);
      }, command.durationMs);
    }
  }

  /** Stops the car. Never throws — stopping must always be attempted. */
  async stop(source: CommandSource = 'manual'): Promise<void> {
    const wasActive = this.active !== null;
    this.halt();
    try {
      await bluetoothManager.sendCarCommand({ command: 'stop', speed: 0, source });
    } catch (error) {
      // If the link is down the firmware watchdog stops the motors.
      log.warn('Stop could not be sent', error);
      if (wasActive) this.errors.emit(toBluetoothError(error, 'write_failed').userMessage);
    }
  }

  /**
   * Clears local timers without sending anything. Used when the link drops:
   * we can't reach the car, and the firmware watchdog will stop it.
   */
  halt(): void {
    this.clearTimers();
    if (this.active !== null) {
      this.active = null;
      this.commandChanges.emit(null);
    }
  }

  private async send(command: CarCommand): Promise<void> {
    try {
      await bluetoothManager.sendCarCommand(command);
    } catch (error) {
      log.warn('Command send failed', error);
      this.halt();
      this.errors.emit(toBluetoothError(error, 'write_failed').userMessage);
    }
  }

  private clearTimers(): void {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    if (this.durationTimer) clearTimeout(this.durationTimer);
    this.keepAliveTimer = null;
    this.durationTimer = null;
  }
}

export const carController = new CarController();
