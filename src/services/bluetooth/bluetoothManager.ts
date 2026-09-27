/**
 * Single entry point for everything Bluetooth. UI and other services use
 * this facade; nothing else imports the transport or builds packets.
 *
 * Demo Mode: whenever no real car is connected, commands are routed to the
 * simulated car (mockCar) using the exact same encoded bytes, so every screen
 * stays testable without an ESP32.
 */
import type { BluetoothAdapterState, BluetoothDevice } from '@/types/bluetooth';
import type { CarCommand, CarStatus } from '@/types/commands';
import type { OLEDState } from '@/types/oled';
import { Emitter, type Unsubscribe } from '@/utils/emitter';
import {
  buildAudioStartMessage,
  buildCarCommandMessage,
  buildOLEDMessage,
  encodeMessage,
  MessageDecoder,
  type OutgoingMessage,
  type StatusMessage,
} from './bleProtocol';
import { blePlxTransport } from './blePlxTransport';
import type { BleTransport } from './bleTransport';
import { BluetoothError } from './bluetoothErrors';
import { ConnectionManager, type ConnectionSnapshot } from './connectionManager';
import { DeviceScanner } from './deviceScanner';
import { mockCar } from './mockCar';

function toCarStatus(message: StatusMessage, origin: CarStatus['origin']): CarStatus {
  return {
    state: message.state,
    command: message.command,
    speed: message.speed,
    battery: message.battery,
    updatedAt: Date.now(),
    origin,
  };
}

class BluetoothManager {
  private readonly scanner: DeviceScanner;
  private readonly connection: ConnectionManager;
  private readonly deviceDecoder = new MessageDecoder();
  private readonly demoDecoder = new MessageDecoder();
  private readonly statusEmitter = new Emitter<CarStatus>();
  private readonly adapterEmitter = new Emitter<BluetoothAdapterState>();
  private adapterState: BluetoothAdapterState = 'unknown';
  private adapterUnsubscribe: Unsubscribe | null = null;

  constructor(private readonly transport: BleTransport) {
    this.scanner = new DeviceScanner(transport);
    this.connection = new ConnectionManager(transport);

    this.connection.incoming.subscribe((bytes) => {
      for (const message of this.deviceDecoder.push(bytes)) {
        this.statusEmitter.emit(toCarStatus(message, 'device'));
      }
    });
    mockCar.notifications.subscribe((bytes) => {
      if (this.connection.isConnected) return;
      for (const message of this.demoDecoder.push(bytes)) {
        this.statusEmitter.emit(toCarStatus(message, 'demo'));
      }
    });
    this.connection.changes.subscribe(({ state }) => {
      if (state !== 'connected') this.deviceDecoder.reset();
      // Moving between demo and real car: make sure neither keeps driving.
      mockCar.reset();
    });
  }

  /** Starts watching the Bluetooth adapter. Safe to call more than once. */
  initialize(): void {
    if (this.adapterUnsubscribe) return;
    this.adapterUnsubscribe = this.transport.onAdapterStateChange((state) => {
      this.adapterState = state;
      this.adapterEmitter.emit(state);
    });
  }

  // --- Status & state ------------------------------------------------------

  isBluetoothAvailable(): boolean {
    return this.transport.isAvailable();
  }

  get currentAdapterState(): BluetoothAdapterState {
    return this.adapterState;
  }

  isConnected(): boolean {
    return this.connection.isConnected;
  }

  /** True when commands go to the simulated car. */
  isDemoMode(): boolean {
    return !this.connection.isConnected;
  }

  /** True when a real car with a speaker is connected (audio can be streamed to it). */
  canPlayAudioOnCar(): boolean {
    return this.connection.supportsAudio;
  }

  /** Largest audio chunk that fits in one BLE write. */
  get maxAudioChunkSize(): number {
    return this.connection.maxWriteSize;
  }

  get pendingWrites(): number {
    return this.connection.pendingWrites;
  }

  setAutoReconnect(enabled: boolean): void {
    this.connection.autoReconnect = enabled;
  }

  subscribeToAdapterState(listener: (state: BluetoothAdapterState) => void): Unsubscribe {
    return this.adapterEmitter.subscribe(listener);
  }

  subscribeToConnection(listener: (snapshot: ConnectionSnapshot) => void): Unsubscribe {
    return this.connection.changes.subscribe(listener);
  }

  /** Status reports from the connected car, or from the simulated car in Demo Mode. */
  subscribeToCarStatus(listener: (status: CarStatus) => void): Unsubscribe {
    return this.statusEmitter.subscribe(listener);
  }

  // --- Scanning & connection ----------------------------------------------

  scanForCars(onUpdate: (devices: BluetoothDevice[]) => void): Promise<BluetoothDevice[]> {
    if (!this.transport.isAvailable()) return Promise.reject(new BluetoothError('unavailable'));
    return this.scanner.scan(onUpdate);
  }

  stopScan(): void {
    this.scanner.stop();
  }

  async connectToCar(device: BluetoothDevice): Promise<void> {
    this.scanner.stop();
    await this.connection.connect(device);
  }

  disconnectFromCar(): Promise<void> {
    return this.connection.disconnect();
  }

  // --- Sending --------------------------------------------------------------

  sendCarCommand(command: CarCommand): Promise<void> {
    return this.send(buildCarCommandMessage(command));
  }

  sendOLEDCommand(state: OLEDState): Promise<void> {
    return this.send(buildOLEDMessage(state));
  }

  // --- Car speaker (see services/audio/carSpeaker.ts) ------------------------

  /** Announces a clip: `samples` at BLE_CONFIG.AUDIO_SAMPLE_RATE, `bytes` encoded bytes to follow. */
  sendAudioStart(samples: number, bytes: number): Promise<void> {
    return this.connection.write('command', encodeMessage(buildAudioStartMessage(samples, bytes)), true);
  }

  /** Encoded audio bytes for the clip announced by sendAudioStart. Keep each call ≤ maxAudioChunkSize. */
  sendAudio(data: Uint8Array): Promise<void> {
    return this.connection.write('audio', data, false);
  }

  sendAudioEnd(): Promise<void> {
    return this.connection.write('command', encodeMessage({ type: 'audio_end' }), true);
  }

  /** Silences the car speaker and drops its buffer. */
  sendAudioStop(): Promise<void> {
    if (!this.connection.isConnected) return Promise.resolve();
    return this.connection.write('command', encodeMessage({ type: 'audio_stop' }), true);
  }

  private send(message: OutgoingMessage): Promise<void> {
    const frame = encodeMessage(message);
    if (this.connection.isConnected) return this.connection.write('command', frame, true);
    mockCar.receive(frame);
    return Promise.resolve();
  }
}

export const bluetoothManager = new BluetoothManager(blePlxTransport);
export type { ConnectionSnapshot };
