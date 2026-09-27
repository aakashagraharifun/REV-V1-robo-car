import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { BluetoothDevice } from '@/types/bluetooth';
import { bluetoothManager } from '@/services/bluetooth/bluetoothManager';
import { toBluetoothError } from '@/services/bluetooth/bluetoothErrors';
import { useAppStore } from '@/store/appStore';

/** Bluetooth state + actions for screens. All BLE work goes through bluetoothManager. */
export function useBluetooth() {
  const state = useAppStore(
    useShallow((s) => ({
      adapterState: s.adapterState,
      connectionState: s.connectionState,
      connectedDevice: s.connectedDevice,
      isScanning: s.isScanning,
      discoveredDevices: s.discoveredDevices,
      autoReconnect: s.autoReconnect,
    })),
  );

  const scan = useCallback(async () => {
    const store = useAppStore.getState();
    store.set({ isScanning: true, discoveredDevices: [] });
    try {
      const devices = await bluetoothManager.scanForCars((found) =>
        useAppStore.getState().set({ discoveredDevices: found }),
      );
      useAppStore.getState().set({ discoveredDevices: devices });
      if (devices.length === 0) {
        useAppStore.getState().showNotice('No cars found. Is the ESP32 powered on and advertising?', 'info');
      }
    } catch (error) {
      useAppStore.getState().showNotice(toBluetoothError(error, 'scan_failed').userMessage, 'error');
    } finally {
      useAppStore.getState().set({ isScanning: false });
    }
  }, []);

  const stopScan = useCallback(() => bluetoothManager.stopScan(), []);

  const connect = useCallback(async (device: BluetoothDevice) => {
    try {
      await bluetoothManager.connectToCar(device);
    } catch (error) {
      useAppStore.getState().showNotice(toBluetoothError(error, 'connection_failed').userMessage, 'error');
    }
  }, []);

  const disconnect = useCallback(async () => {
    await bluetoothManager.disconnectFromCar();
    useAppStore.getState().showNotice('Disconnected. Demo Mode is on.', 'info');
  }, []);

  const setAutoReconnect = useCallback((autoReconnect: boolean) => useAppStore.getState().set({ autoReconnect }), []);

  return {
    ...state,
    isDemoMode: state.connectionState !== 'connected',
    isBluetoothAvailable: bluetoothManager.isBluetoothAvailable(),
    scan,
    stopScan,
    connect,
    disconnect,
    setAutoReconnect,
  };
}
