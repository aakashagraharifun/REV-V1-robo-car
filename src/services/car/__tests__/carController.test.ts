/**
 * Integration test of the command path in Demo Mode:
 * carController → validator → bluetoothManager → protocol → mockCar.
 */
import { SAFETY_CONFIG } from '@/config/safetyConfig';
import { bluetoothManager } from '@/services/bluetooth/bluetoothManager';
import { mockCar } from '@/services/bluetooth/mockCar';
import { utf8Decode } from '@/utils/encoding';
import { carController } from '../carController';

describe('carController (Demo Mode)', () => {
  let frames: string[];
  let receive: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    frames = [];
    receive = jest.spyOn(mockCar, 'receive').mockImplementation((bytes: Uint8Array) => {
      frames.push(utf8Decode(bytes).trim());
    });
    carController.setSpeedLimit(80);
  });

  afterEach(async () => {
    await carController.stop();
    receive.mockRestore();
    jest.useRealTimers();
  });

  it('runs in demo mode when no ESP32 is connected', () => {
    expect(bluetoothManager.isDemoMode()).toBe(true);
  });

  it('sends keep-alives while held and a stop on release', async () => {
    await carController.driveManual('forward', 70);
    expect(frames[0]).toBe('{"type":"car_command","command":"forward","speed":70}');

    jest.advanceTimersByTime(SAFETY_CONFIG.KEEPALIVE_INTERVAL_MS * 3);
    expect(frames.length).toBeGreaterThanOrEqual(4);

    await carController.stop();
    expect(frames.at(-1)).toBe('{"type":"car_command","command":"stop"}');
    expect(carController.currentCommand).toBeNull();

    const count = frames.length;
    jest.advanceTimersByTime(SAFETY_CONFIG.KEEPALIVE_INTERVAL_MS * 3);
    expect(frames.length).toBe(count); // no keep-alives after stop
  });

  it('enforces the speed limit on manual input', async () => {
    await carController.driveManual('left', 100);
    expect(frames[0]).toBe('{"type":"car_command","command":"left","speed":80}');
  });

  it('stops timed commands automatically', async () => {
    await carController.drive({ command: 'right', speed: 50, durationMs: 1000, source: 'ai' });
    expect(carController.currentCommand?.command).toBe('right');
    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(carController.currentCommand).toBeNull();
    expect(frames.at(-1)).toBe('{"type":"car_command","command":"stop"}');
  });

  it('halt() clears timers without sending (link lost)', async () => {
    await carController.driveManual('backward', 40);
    const count = frames.length;
    carController.halt();
    jest.advanceTimersByTime(SAFETY_CONFIG.KEEPALIVE_INTERVAL_MS * 5);
    expect(frames.length).toBe(count);
    expect(carController.currentCommand).toBeNull();
  });
});
