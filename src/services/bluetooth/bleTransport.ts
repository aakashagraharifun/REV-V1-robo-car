/**
 * Low-level BLE transport contract. `blePlxTransport` implements it with
 * react-native-ble-plx; swap in another implementation (or a native module)
 * without touching the rest of the app.
 */
import type {
  BluetoothAdapterState,
  BluetoothDevice,
  CharacteristicRole,
} from '@/types/bluetooth';
import type { Unsubscribe } from '@/utils/emitter';
import type { BluetoothError } from './bluetoothErrors';

export interface ScannedDevice extends BluetoothDevice {
  serviceUUIDs: string[];
}

export interface ConnectedDevice {
  device: BluetoothDevice;
  /** Negotiated ATT MTU. Usable payload per write is `mtu - 3`. */
  mtu: number;
  /** True when the firmware exposes the audio characteristic (car speaker). */
  hasAudio: boolean;
}

export interface BleTransport {
  /** False when the native BLE module isn't present (Expo Go, web). */
  isAvailable(): boolean;
  getAdapterState(): Promise<BluetoothAdapterState>;
  onAdapterStateChange(listener: (state: BluetoothAdapterState) => void): Unsubscribe;
  /** Requests runtime permissions. Resolves true when scanning/connecting is allowed. */
  requestPermissions(): Promise<boolean>;

  startScan(onDevice: (device: ScannedDevice) => void, onError: (error: BluetoothError) => void): Promise<void>;
  stopScan(): Promise<void>;

  /** Connects, discovers services, negotiates MTU and verifies the car's service exists. */
  connect(deviceId: string, timeoutMs: number): Promise<ConnectedDevice>;
  disconnect(deviceId: string): Promise<void>;

  write(deviceId: string, role: Exclude<CharacteristicRole, 'status'>, bytes: Uint8Array, withResponse: boolean): Promise<void>;
  monitor(
    deviceId: string,
    role: 'status',
    onData: (bytes: Uint8Array) => void,
    onError: (error: BluetoothError) => void,
  ): Unsubscribe;
  onDisconnected(deviceId: string, listener: (error: BluetoothError | null) => void): Unsubscribe;
}
