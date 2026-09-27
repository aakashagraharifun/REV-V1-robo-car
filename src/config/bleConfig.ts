/**
 * Bluetooth Low Energy configuration.
 *
 * ⚠️ PLACEHOLDER UUIDs — the ESP32 firmware does not exist yet.
 * When you write the firmware, generate your own UUIDs (e.g. `uuidgen`), use
 * them on both sides, and replace the four values below. Nothing else in the
 * app references UUIDs directly.
 */
export const BLE_CONFIG = {
  /** Primary GATT service exposed by the car. */
  SERVICE_UUID: '6e400001-0000-4000-8000-00000000c0de',
  /** Phone → car: JSON commands (write / write-without-response). */
  COMMAND_CHARACTERISTIC_UUID: '6e400002-0000-4000-8000-00000000c0de',
  /** Car → phone: JSON status (notify). */
  STATUS_CHARACTERISTIC_UUID: '6e400003-0000-4000-8000-00000000c0de',
  /** Phone → car: compressed audio for the car's speaker (write without response). Optional in firmware. */
  AUDIO_CHARACTERISTIC_UUID: '6e400004-0000-4000-8000-00000000c0de',

  /**
   * Advertised name prefixes treated as "a car" during scanning.
   * Set the firmware's BLE name to start with one of these, e.g. "Robo-Car".
   */
  DEVICE_NAME_PREFIXES: ['Robo', 'ESP32'],
  /** When true, the scan list also shows unnamed / non-matching devices. */
  SHOW_ALL_DEVICES: false,

  SCAN_TIMEOUT_MS: 10_000,
  CONNECT_TIMEOUT_MS: 10_000,

  /**
   * Android MTU requested after connecting. The default BLE MTU (23) only
   * leaves 20 bytes per write; our JSON messages are ~60 bytes. If the
   * request is refused, messages are split into chunks automatically.
   */
  REQUESTED_MTU: 185,

  /** Every message ends with this byte so the firmware knows where it stops. */
  MESSAGE_TERMINATOR: '\n',

  /**
   * Car speaker audio (ESP32 → I2S → MAX98357A). The firmware must use the
   * same sample rate and format. IMA ADPCM = 4 bits/sample, so 16 kHz audio
   * is 8000 bytes per second over BLE.
   */
  AUDIO_SAMPLE_RATE: 16_000,
  AUDIO_FORMAT: 'ima_adpcm',
  /** How far (ms of audio) the phone may send ahead of playback. Firmware buffer must hold more. */
  AUDIO_MAX_LEAD_MS: 1_000,
  /** The firmware waits for this much audio before it starts playing (and after an underrun). */
  AUDIO_PREBUFFER_MS: 250,

  /** Automatic reconnection after an unexpected disconnect. */
  RECONNECT_MAX_ATTEMPTS: 3,
  RECONNECT_BASE_DELAY_MS: 1_000,
} as const;
