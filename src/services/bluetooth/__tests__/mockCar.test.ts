import { SAFETY_CONFIG } from '@/config/safetyConfig';
import { utf8Encode } from '@/utils/encoding';
import { MessageDecoder, type StatusMessage } from '../bleProtocol';
import { mockCar } from '../mockCar';

describe('mockCar (simulated ESP32)', () => {
  let statuses: StatusMessage[];
  let unsubscribe: () => void;

  beforeEach(() => {
    jest.useFakeTimers();
    mockCar.reset();
    statuses = [];
    const decoder = new MessageDecoder();
    unsubscribe = mockCar.notifications.subscribe((bytes) => statuses.push(...decoder.push(bytes)));
  });

  afterEach(() => {
    unsubscribe();
    jest.useRealTimers();
  });

  const send = (json: object) => mockCar.receive(utf8Encode(JSON.stringify(json) + '\n'));

  it('reports moving, then stops itself when keep-alives stop (watchdog)', () => {
    send({ type: 'car_command', command: 'forward', speed: 60 });
    jest.advanceTimersByTime(100);
    expect(statuses.at(-1)).toMatchObject({ state: 'moving', command: 'forward', speed: 60 });

    jest.advanceTimersByTime(SAFETY_CONFIG.FIRMWARE_WATCHDOG_MS + 100);
    expect(statuses.at(-1)).toMatchObject({ state: 'stopped', speed: 0, message: 'watchdog' });
  });

  it('keeps moving while keep-alives arrive', () => {
    send({ type: 'car_command', command: 'left', speed: 40 });
    for (let i = 0; i < 10; i++) {
      jest.advanceTimersByTime(SAFETY_CONFIG.KEEPALIVE_INTERVAL_MS);
      send({ type: 'car_command', command: 'left', speed: 40 });
    }
    jest.advanceTimersByTime(100);
    expect(statuses.filter((s) => s.state === 'stopped')).toHaveLength(0);
  });

  it('re-validates commands like real firmware should', () => {
    send({ type: 'car_command', command: 'forward', speed: 500 });
    send({ type: 'car_command', command: 'self_destruct' });
    jest.advanceTimersByTime(100);
    expect(statuses.map((s) => s.message)).toEqual(['bad speed', 'unknown command']);
  });
});
