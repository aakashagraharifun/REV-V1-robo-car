import type { BluetoothErrorCode } from '@/types/bluetooth';

const USER_MESSAGES: Record<BluetoothErrorCode, string> = {
  unavailable: 'Bluetooth isn’t available in this build. Use a development build or APK (Demo Mode still works).',
  powered_off: 'Bluetooth is turned off. Turn it on to connect to the car.',
  permission_denied: 'Bluetooth permission was denied. Allow “Nearby devices” in Android settings.',
  scan_failed: 'Couldn’t search for cars. Check that Bluetooth and Location are on, then try again.',
  device_not_found: 'Car not found. Make sure the ESP32 is powered on and nearby.',
  connection_failed: 'Couldn’t connect to the car. Move closer and try again.',
  service_not_found: 'Connected, but this device doesn’t look like the Robo car (service UUID mismatch).',
  not_connected: 'The car isn’t connected.',
  write_failed: 'Couldn’t send the command to the car.',
  disconnected: 'The car disconnected.',
  unknown: 'Something went wrong with Bluetooth.',
};

export class BluetoothError extends Error {
  readonly code: BluetoothErrorCode;
  readonly userMessage: string;

  constructor(code: BluetoothErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'BluetoothError';
    this.code = code;
    this.userMessage = USER_MESSAGES[code];
  }
}

export function toBluetoothError(error: unknown, fallback: BluetoothErrorCode = 'unknown'): BluetoothError {
  if (error instanceof BluetoothError) return error;
  const detail = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;
  return new BluetoothError(fallback, detail);
}
