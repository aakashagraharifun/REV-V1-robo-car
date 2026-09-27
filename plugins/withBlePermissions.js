/**
 * Local Expo config plugin for Bluetooth Low Energy.
 *
 * Why this exists instead of `react-native-ble-plx`'s bundled plugin:
 * the bundled plugin (v3.5.1) imports `@expo/config-plugins` directly, which
 * fails to resolve on Expo SDK 56+ (dotintent/react-native-ble-plx#1339).
 *
 * Android runtime permissions (BLUETOOTH_SCAN with neverForLocation,
 * BLUETOOTH_CONNECT, legacy BLUETOOTH/ADMIN, location for Android <= 11) are
 * already declared in the library's own AndroidManifest.xml and are merged in
 * at build time. This plugin only adds what the library does not:
 *   - <uses-feature android.hardware.bluetooth_le required="false"> so the app
 *     still installs on phones without BLE (it falls back to Demo Mode).
 *   - The iOS Bluetooth usage description.
 */
const { withAndroidManifest, withInfoPlist } = require('expo/config-plugins');

const BLE_FEATURE = 'android.hardware.bluetooth_le';
const IOS_BLUETOOTH_MESSAGE = 'Robo uses Bluetooth to connect to and drive your robot car.';

function withBleFeature(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const features = Array.isArray(manifest['uses-feature']) ? manifest['uses-feature'] : [];
    if (!features.some((f) => f.$ && f.$['android:name'] === BLE_FEATURE)) {
      features.push({ $: { 'android:name': BLE_FEATURE, 'android:required': 'false' } });
    }
    manifest['uses-feature'] = features;
    return cfg;
  });
}

function withIosBluetoothUsage(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.NSBluetoothAlwaysUsageDescription =
      cfg.modResults.NSBluetoothAlwaysUsageDescription || IOS_BLUETOOTH_MESSAGE;
    return cfg;
  });
}

module.exports = function withBlePermissions(config) {
  return withIosBluetoothUsage(withBleFeature(config));
};
