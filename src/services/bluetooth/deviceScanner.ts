/**
 * Finds nearby cars. Scans for BLE_CONFIG.SCAN_TIMEOUT_MS, de-duplicates,
 * filters to devices that look like the Robo car, and sorts by signal.
 */
import { BLE_CONFIG } from '@/config/bleConfig';
import type { BluetoothDevice } from '@/types/bluetooth';
import type { BleTransport, ScannedDevice } from './bleTransport';
import { BluetoothError } from './bluetoothErrors';

export function isLikelyCar(device: ScannedDevice): boolean {
  if (BLE_CONFIG.SHOW_ALL_DEVICES) return true;
  const advertisesService = device.serviceUUIDs.some(
    (uuid) => uuid.toLowerCase() === BLE_CONFIG.SERVICE_UUID.toLowerCase(),
  );
  const name = device.name ?? '';
  const nameMatches = BLE_CONFIG.DEVICE_NAME_PREFIXES.some((prefix) =>
    name.toLowerCase().startsWith(prefix.toLowerCase()),
  );
  return advertisesService || nameMatches;
}

function sortBySignal(devices: Iterable<BluetoothDevice>): BluetoothDevice[] {
  return [...devices].sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
}

export class DeviceScanner {
  private finish: (() => void) | null = null;

  constructor(private readonly transport: BleTransport) {}

  get isScanning(): boolean {
    return this.finish !== null;
  }

  /**
   * Scans until the timeout or `stop()`. `onUpdate` receives the growing list.
   * Resolves with the final list; rejects with a BluetoothError if the scan can't start.
   */
  async scan(onUpdate: (devices: BluetoothDevice[]) => void, timeoutMs: number = BLE_CONFIG.SCAN_TIMEOUT_MS): Promise<BluetoothDevice[]> {
    if (this.isScanning) this.stop();

    const allowed = await this.transport.requestPermissions();
    if (!allowed) throw new BluetoothError('permission_denied');

    const adapter = await this.transport.getAdapterState();
    if (adapter === 'unavailable' || adapter === 'unsupported') throw new BluetoothError('unavailable');
    if (adapter === 'poweredOff') throw new BluetoothError('powered_off');
    if (adapter === 'unauthorized') throw new BluetoothError('permission_denied');

    const found = new Map<string, BluetoothDevice>();

    return new Promise<BluetoothDevice[]>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => this.stop(), timeoutMs);

      const settle = (error?: BluetoothError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.finish = null;
        void this.transport.stopScan();
        if (error) reject(error);
        else resolve(sortBySignal(found.values()));
      };
      this.finish = () => settle();

      this.transport
        .startScan(
          (device) => {
            if (!isLikelyCar(device)) return;
            const previous = found.get(device.id);
            found.set(device.id, {
              id: device.id,
              name: device.name ?? previous?.name ?? null,
              rssi: device.rssi ?? previous?.rssi ?? null,
            });
            onUpdate(sortBySignal(found.values()));
          },
          (error) => settle(error),
        )
        .catch((error: unknown) => settle(error instanceof BluetoothError ? error : new BluetoothError('scan_failed')));
    });
  }

  stop(): void {
    this.finish?.();
  }
}
