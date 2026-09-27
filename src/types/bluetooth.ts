/** State of the phone's Bluetooth adapter. */
export type BluetoothAdapterState =
  | 'unknown'
  | 'unavailable' // BLE native module missing (e.g. Expo Go / web)
  | 'unsupported' // phone has no BLE hardware
  | 'unauthorized' // permission denied
  | 'poweredOff'
  | 'poweredOn';

/** State of the link between the app and the car. */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface BluetoothDevice {
  id: string;
  name: string | null;
  rssi: number | null;
}

/** Logical BLE characteristics the app talks to (UUIDs live in bleConfig). */
export type CharacteristicRole = 'command' | 'status' | 'audio';

export type BluetoothErrorCode =
  | 'unavailable'
  | 'powered_off'
  | 'permission_denied'
  | 'scan_failed'
  | 'device_not_found'
  | 'connection_failed'
  | 'service_not_found'
  | 'not_connected'
  | 'write_failed'
  | 'disconnected'
  | 'unknown';
