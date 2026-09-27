/**
 * BleTransport implementation backed by react-native-ble-plx.
 *
 * The native module only exists in a development build / APK. In Expo Go or
 * on web `isAvailable()` returns false and the app runs in Demo Mode.
 */
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import {
  BleError,
  BleErrorCode,
  BleManager,
  ConnectionPriority,
  ScanMode,
  State,
  type Subscription,
} from 'react-native-ble-plx';

import { BLE_CONFIG } from '@/config/bleConfig';
import type { BluetoothAdapterState, BluetoothErrorCode } from '@/types/bluetooth';
import { base64ToBytes, bytesToBase64 } from '@/utils/encoding';
import { createLogger } from '@/utils/logger';
import type { BleTransport, ConnectedDevice, ScannedDevice } from './bleTransport';
import { BluetoothError } from './bluetoothErrors';

const log = createLogger('BLE');
const DEFAULT_MTU = 23;

const ROLE_TO_UUID = {
  command: BLE_CONFIG.COMMAND_CHARACTERISTIC_UUID,
  status: BLE_CONFIG.STATUS_CHARACTERISTIC_UUID,
  audio: BLE_CONFIG.AUDIO_CHARACTERISTIC_UUID,
} as const;

function mapState(state: State): BluetoothAdapterState {
  switch (state) {
    case State.PoweredOn:
      return 'poweredOn';
    case State.PoweredOff:
      return 'poweredOff';
    case State.Unauthorized:
      return 'unauthorized';
    case State.Unsupported:
      return 'unsupported';
    default:
      return 'unknown';
  }
}

function mapBleError(error: unknown, fallback: BluetoothErrorCode): BluetoothError {
  if (error instanceof BluetoothError) return error;
  if (error instanceof BleError) {
    const detail = error.reason ?? error.message;
    switch (error.errorCode) {
      case BleErrorCode.BluetoothPoweredOff:
        return new BluetoothError('powered_off', detail);
      case BleErrorCode.BluetoothUnauthorized:
        return new BluetoothError('permission_denied', detail);
      case BleErrorCode.BluetoothUnsupported:
        return new BluetoothError('unavailable', detail);
      case BleErrorCode.DeviceNotFound:
        return new BluetoothError('device_not_found', detail);
      case BleErrorCode.DeviceDisconnected:
        return new BluetoothError('disconnected', detail);
      case BleErrorCode.DeviceNotConnected:
        return new BluetoothError('not_connected', detail);
      case BleErrorCode.ServiceNotFound:
      case BleErrorCode.CharacteristicNotFound:
        return new BluetoothError('service_not_found', detail);
      case BleErrorCode.LocationServicesDisabled:
      case BleErrorCode.ScanStartFailed:
        return new BluetoothError('scan_failed', detail);
      default:
        return new BluetoothError(fallback, detail);
    }
  }
  return new BluetoothError(fallback, error instanceof Error ? error.message : undefined);
}

function sameUuid(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

class BlePlxTransport implements BleTransport {
  private manager: BleManager | null = null;
  private initFailed = false;

  /** Creates the BleManager on first use; returns null when BLE can't work here. */
  private getManager(): BleManager | null {
    if (this.manager || this.initFailed) return this.manager;
    if (Platform.OS === 'web' || !NativeModules.BlePlx) {
      this.initFailed = true;
      return null;
    }
    try {
      this.manager = new BleManager();
    } catch (error) {
      log.warn('BleManager init failed', error);
      this.initFailed = true;
    }
    return this.manager;
  }

  private requireManager(): BleManager {
    const manager = this.getManager();
    if (!manager) throw new BluetoothError('unavailable');
    return manager;
  }

  isAvailable(): boolean {
    return this.getManager() !== null;
  }

  async getAdapterState(): Promise<BluetoothAdapterState> {
    const manager = this.getManager();
    if (!manager) return 'unavailable';
    try {
      return mapState(await manager.state());
    } catch {
      return 'unknown';
    }
  }

  onAdapterStateChange(listener: (state: BluetoothAdapterState) => void) {
    const manager = this.getManager();
    if (!manager) {
      listener('unavailable');
      return () => {};
    }
    const sub = manager.onStateChange((state) => listener(mapState(state)), true);
    return () => sub.remove();
  }

  async requestPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : parseInt(Platform.Version, 10);
    try {
      if (apiLevel >= 31) {
        const result = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]);
        return Object.values(result).every((r) => r === PermissionsAndroid.RESULTS.GRANTED);
      }
      // Android 11 and older need location permission to scan for BLE devices.
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
      return result === PermissionsAndroid.RESULTS.GRANTED;
    } catch (error) {
      log.warn('Permission request failed', error);
      return false;
    }
  }

  async startScan(onDevice: (device: ScannedDevice) => void, onError: (error: BluetoothError) => void): Promise<void> {
    const manager = this.requireManager();
    try {
      await manager.startDeviceScan(
        null,
        { allowDuplicates: false, scanMode: ScanMode.LowLatency },
        (error, device) => {
          if (error) {
            onError(mapBleError(error, 'scan_failed'));
            return;
          }
          if (!device) return;
          onDevice({
            id: device.id,
            name: device.localName ?? device.name ?? null,
            rssi: device.rssi ?? null,
            serviceUUIDs: device.serviceUUIDs ?? [],
          });
        },
      );
    } catch (error) {
      throw mapBleError(error, 'scan_failed');
    }
  }

  async stopScan(): Promise<void> {
    const manager = this.getManager();
    if (!manager) return;
    try {
      await manager.stopDeviceScan();
    } catch (error) {
      log.debug('stopScan failed', error);
    }
  }

  async connect(deviceId: string, timeoutMs: number): Promise<ConnectedDevice> {
    const manager = this.requireManager();
    try {
      let device = await manager.connectToDevice(deviceId, {
        timeout: timeoutMs,
        ...(Platform.OS === 'android' ? { requestMTU: BLE_CONFIG.REQUESTED_MTU } : {}),
      });
      device = await device.discoverAllServicesAndCharacteristics();

      if (Platform.OS === 'android' && (device.mtu ?? DEFAULT_MTU) < BLE_CONFIG.REQUESTED_MTU) {
        try {
          device = await manager.requestMTUForDevice(deviceId, BLE_CONFIG.REQUESTED_MTU);
        } catch (error) {
          log.debug('MTU request refused; messages will be chunked', error);
        }
      }

      const characteristics = await manager.characteristicsForDevice(deviceId, BLE_CONFIG.SERVICE_UUID);
      const hasCommand = characteristics.some((c) => sameUuid(c.uuid, BLE_CONFIG.COMMAND_CHARACTERISTIC_UUID));
      const hasStatus = characteristics.some((c) => sameUuid(c.uuid, BLE_CONFIG.STATUS_CHARACTERISTIC_UUID));
      const hasAudio = characteristics.some((c) => sameUuid(c.uuid, BLE_CONFIG.AUDIO_CHARACTERISTIC_UUID));
      if (!hasCommand || !hasStatus) {
        await this.disconnect(deviceId);
        throw new BluetoothError('service_not_found', 'command/status characteristic missing');
      }

      if (Platform.OS === 'android' && hasAudio) {
        // Shorter connection interval = enough throughput to stream speech to the car speaker.
        try {
          await manager.requestConnectionPriorityForDevice(deviceId, ConnectionPriority.High);
        } catch (error) {
          log.debug('Connection priority request refused', error);
        }
      }

      return {
        device: { id: device.id, name: device.localName ?? device.name ?? null, rssi: device.rssi ?? null },
        mtu: device.mtu ?? DEFAULT_MTU,
        hasAudio,
      };
    } catch (error) {
      if (!(error instanceof BluetoothError)) await this.disconnect(deviceId);
      throw mapBleError(error, 'connection_failed');
    }
  }

  async disconnect(deviceId: string): Promise<void> {
    const manager = this.getManager();
    if (!manager) return;
    try {
      await manager.cancelDeviceConnection(deviceId);
    } catch {
      // Already disconnected.
    }
  }

  async write(deviceId: string, role: 'command' | 'audio', bytes: Uint8Array, withResponse: boolean): Promise<void> {
    const manager = this.requireManager();
    const value = bytesToBase64(bytes);
    try {
      if (withResponse) {
        await manager.writeCharacteristicWithResponseForDevice(deviceId, BLE_CONFIG.SERVICE_UUID, ROLE_TO_UUID[role], value);
      } else {
        await manager.writeCharacteristicWithoutResponseForDevice(deviceId, BLE_CONFIG.SERVICE_UUID, ROLE_TO_UUID[role], value);
      }
    } catch (error) {
      throw mapBleError(error, 'write_failed');
    }
  }

  monitor(
    deviceId: string,
    role: 'status',
    onData: (bytes: Uint8Array) => void,
    onError: (error: BluetoothError) => void,
  ) {
    const manager = this.requireManager();
    const sub: Subscription = manager.monitorCharacteristicForDevice(
      deviceId,
      BLE_CONFIG.SERVICE_UUID,
      ROLE_TO_UUID[role],
      (error, characteristic) => {
        if (error) {
          // Cancelled monitors fire an error on normal disconnect; ignore those.
          if (error.errorCode !== BleErrorCode.OperationCancelled) onError(mapBleError(error, 'unknown'));
          return;
        }
        if (characteristic?.value) onData(base64ToBytes(characteristic.value));
      },
    );
    return () => sub.remove();
  }

  onDisconnected(deviceId: string, listener: (error: BluetoothError | null) => void) {
    const manager = this.getManager();
    if (!manager) return () => {};
    const sub = manager.onDeviceDisconnected(deviceId, (error) => {
      listener(error ? mapBleError(error, 'disconnected') : null);
    });
    return () => sub.remove();
  }
}

export const blePlxTransport: BleTransport = new BlePlxTransport();
