import { BLE_CONFIG } from '@/config/bleConfig';
import { bluetoothManager } from '@/services/bluetooth/bluetoothManager';
import { playOnCar, prepareCarClip } from '../carSpeaker';

jest.mock('@/services/bluetooth/bluetoothManager', () => ({
  bluetoothManager: {
    maxAudioChunkSize: 182,
    sendAudioStart: jest.fn(() => Promise.resolve()),
    sendAudio: jest.fn(() => Promise.resolve()),
    sendAudioEnd: jest.fn(() => Promise.resolve()),
    sendAudioStop: jest.fn(() => Promise.resolve()),
  },
}));

const bt = bluetoothManager as jest.Mocked<typeof bluetoothManager>;
const BYTES_PER_SECOND = BLE_CONFIG.AUDIO_SAMPLE_RATE / 2;

function clipOfSeconds(seconds: number) {
  const samples = new Int16Array(Math.round(24000 * seconds)).map((_, i) => Math.round(8000 * Math.sin(i / 5)));
  return prepareCarClip({ sampleRate: 24000, samples });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('prepareCarClip', () => {
  it('converts to 16 kHz ADPCM', () => {
    const clip = clipOfSeconds(1);
    expect(clip.samples).toBe(16000);
    expect(clip.bytes.length).toBe(8000);
    expect(clip.durationMs).toBe(1000);
  });
});

describe('playOnCar', () => {
  it('announces, streams every byte in MTU-sized chunks, then ends', async () => {
    const clip = clipOfSeconds(0.5);
    const done = playOnCar(clip, new AbortController().signal);
    await jest.advanceTimersByTimeAsync(5_000);
    await done;

    expect(bt.sendAudioStart).toHaveBeenCalledWith(clip.samples, clip.bytes.length);
    const chunks = bt.sendAudio.mock.calls.map(([chunk]) => chunk);
    expect(chunks.every((c) => c.length <= 182)).toBe(true);
    expect(chunks.reduce((n, c) => n + c.length, 0)).toBe(clip.bytes.length);
    expect(bt.sendAudioEnd).toHaveBeenCalledTimes(1);
    expect(bt.sendAudioStop).not.toHaveBeenCalled();
  });

  it('never gets more than the allowed lead ahead of playback', async () => {
    const clip = clipOfSeconds(4);
    const start = Date.now();
    let sent = 0;
    let worstLead = 0;
    bt.sendAudio.mockImplementation((chunk: Uint8Array) => {
      sent += chunk.length;
      const played = ((Date.now() - start) / 1000) * BYTES_PER_SECOND;
      worstLead = Math.max(worstLead, sent - played);
      return Promise.resolve();
    });

    const done = playOnCar(clip, new AbortController().signal);
    await jest.advanceTimersByTimeAsync(10_000);
    await done;

    expect(sent).toBe(clip.bytes.length);
    const allowed = (BLE_CONFIG.AUDIO_MAX_LEAD_MS / 1000) * BYTES_PER_SECOND + 182;
    expect(worstLead).toBeLessThanOrEqual(allowed);
  });

  it('resolves only after the clip has had time to play', async () => {
    const clip = clipOfSeconds(2);
    let finished = false;
    void playOnCar(clip, new AbortController().signal).then(() => {
      finished = true;
    });
    await jest.advanceTimersByTimeAsync(1_500);
    expect(finished).toBe(false);
    await jest.advanceTimersByTimeAsync(2_000);
    expect(finished).toBe(true);
  });

  it('stops the car speaker when cancelled', async () => {
    const controller = new AbortController();
    const done = playOnCar(clipOfSeconds(3), controller.signal);
    await jest.advanceTimersByTimeAsync(500);
    controller.abort();
    await jest.advanceTimersByTimeAsync(100);
    await done;
    expect(bt.sendAudioStop).toHaveBeenCalledTimes(1);
    expect(bt.sendAudioEnd).not.toHaveBeenCalled();
  });

  it('surfaces link errors so the caller can fall back to the phone', async () => {
    bt.sendAudio.mockRejectedValueOnce(new Error('disconnected'));
    const done = playOnCar(clipOfSeconds(0.5), new AbortController().signal);
    const assertion = expect(done).rejects.toThrow('disconnected');
    await jest.advanceTimersByTimeAsync(100);
    await assertion;
  });
});
