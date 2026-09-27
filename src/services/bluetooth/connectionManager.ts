/**
 * Owns the link to one car: connect, detect drops, reconnect with backoff,
 * serialise writes, and forward status notifications as raw bytes.
 */
import { BLE_CONFIG } from '@/config/bleConfig';
import type { BluetoothDevice, ConnectionState } from '@/types/bluetooth';
import { Emitter, type Unsubscribe } from '@/utils/emitter';
import { sleep } from '@/utils/async';
import { createLogger } from '@/utils/logger';
import { chunkBytes } from './bleProtocol';
import type { BleTransport } from './bleTransport';
import { BluetoothError, toBluetoothError } from './bluetoothErrors';

const log = createLogger('Connection');
const ATT_HEADER_BYTES = 3;

export interface ConnectionSnapshot {
  state: ConnectionState;
  device: BluetoothDevice | null;
  error: BluetoothError | null;
}

export class ConnectionManager {
  private state: ConnectionState = 'disconnected';
  private device: BluetoothDevice | null = null;
  private mtu = 23;
  private hasAudio = false;
  private linkSubscriptions: Unsubscribe[] = [];
  private userDisconnected = false;
  private reconnectToken = 0;
  private writeChain: Promise<void> = Promise.resolve();
  private pending = 0;

  autoReconnect = true;

  /** Fires on every state change. */
  readonly changes = new Emitter<ConnectionSnapshot>();
  /** Raw bytes notified on the status characteristic. */
  readonly incoming = new Emitter<Uint8Array>();

  constructor(private readonly transport: BleTransport) {}

  get snapshot(): ConnectionSnapshot {
    return { state: this.state, device: this.device, error: null };
  }

  get isConnected(): boolean {
    return this.state === 'connected';
  }

  /** True when the connected car has a speaker (audio characteristic). */
  get supportsAudio(): boolean {
    return this.isConnected && this.hasAudio;
  }

  /** Largest payload that fits in one BLE write. */
  get maxWriteSize(): number {
    return this.mtu - ATT_HEADER_BYTES;
  }

  /** Number of writes queued but not yet acknowledged. */
  get pendingWrites(): number {
    return this.pending;
  }

  async connect(device: BluetoothDevice): Promise<void> {
    if (this.device && this.device.id !== device.id) await this.disconnect();
    this.userDisconnected = false;
    this.reconnectToken++;
    this.device = device;
    this.setState('connecting');
    try {
      await this.establish(device);
      this.setState('connected');
    } catch (error) {
      const btError = toBluetoothError(error, 'connection_failed');
      this.device = null;
      this.setState('disconnected', btError);
      throw btError;
    }
  }

  async disconnect(): Promise<void> {
    this.userDisconnected = true;
    this.reconnectToken++;
    const deviceId = this.device?.id;
    this.teardownLink();
    this.device = null;
    this.setState('disconnected');
    if (deviceId) await this.transport.disconnect(deviceId);
  }

  /** Sends bytes, splitting them to fit the negotiated MTU. Writes never interleave. */
  write(role: 'command' | 'audio', bytes: Uint8Array, withResponse = true): Promise<void> {
    if (this.state !== 'connected' || !this.device) {
      return Promise.reject(new BluetoothError('not_connected'));
    }
    const deviceId = this.device.id;
    const chunks = chunkBytes(bytes, this.mtu - ATT_HEADER_BYTES);
    this.pending++;
    const job = this.writeChain.then(async () => {
      for (const chunk of chunks) {
        await this.transport.write(deviceId, role, chunk, withResponse);
      }
    });
    // Keep the chain alive even if this write fails.
    this.writeChain = job.catch(() => undefined);
    return job.finally(() => {
      this.pending--;
    });
  }

  private async establish(device: BluetoothDevice): Promise<void> {
    const connected = await this.transport.connect(device.id, BLE_CONFIG.CONNECT_TIMEOUT_MS);
    this.mtu = Math.max(23, connected.mtu);
    this.hasAudio = connected.hasAudio;
    this.device = { ...device, name: connected.device.name ?? device.name };
    log.info('Connected', { name: this.device.name, mtu: this.mtu, speaker: this.hasAudio });

    this.teardownLink();
    this.linkSubscriptions.push(
      this.transport.monitor(
        device.id,
        'status',
        (bytes) => this.incoming.emit(bytes),
        (error) => log.warn('Status notifications failed', error),
      ),
      this.transport.onDisconnected(device.id, (error) => this.handleLinkLost(error)),
    );
  }

  private teardownLink(): void {
    this.linkSubscriptions.forEach((unsubscribe) => unsubscribe());
    this.linkSubscriptions = [];
  }

  private handleLinkLost(error: BluetoothError | null): void {
    this.teardownLink();
    if (this.userDisconnected || !this.device) return;
    log.warn('Link lost', error);
    const device = this.device;

    if (!this.autoReconnect) {
      this.device = null;
      this.setState('disconnected', error ?? new BluetoothError('disconnected'));
      return;
    }
    void this.reconnect(device);
  }

  private async reconnect(device: BluetoothDevice): Promise<void> {
    const token = ++this.reconnectToken;
    this.setState('reconnecting', new BluetoothError('disconnected'));

    for (let attempt = 1; attempt <= BLE_CONFIG.RECONNECT_MAX_ATTEMPTS; attempt++) {
      await sleep(BLE_CONFIG.RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1));
      if (token !== this.reconnectToken) return; // user connected/disconnected meanwhile
      try {
        await this.establish(device);
        if (token !== this.reconnectToken) return;
        this.setState('connected');
        return;
      } catch (error) {
        log.warn(`Reconnect attempt ${attempt} failed`, error);
      }
    }
    if (token !== this.reconnectToken) return;
    this.device = null;
    this.setState('disconnected', new BluetoothError('disconnected'));
  }

  private setState(state: ConnectionState, error: BluetoothError | null = null): void {
    this.state = state;
    this.changes.emit({ state, device: this.device, error });
  }
}
