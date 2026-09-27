/**
 * Decides which face the OLED shows and sends it to the car.
 *
 * Priority: manual preview override > error flash > voice activity
 * (listening / thinking / speaking) > motion (moving / stopped) > idle.
 * The app only sends the state name; the ESP32 draws the face.
 */
import type { OLEDState } from '@/types/oled';
import type { VoiceState } from '@/types/voice';
import { bluetoothManager } from '@/services/bluetooth/bluetoothManager';
import { Emitter } from '@/utils/emitter';
import { createLogger } from '@/utils/logger';

const log = createLogger('OLED');
const ERROR_FLASH_MS = 2_500;
const STOPPED_DISPLAY_MS = 1_500;

type Motion = 'idle' | 'moving' | 'stopped';

class OledService {
  private voice: VoiceState = 'idle';
  private motion: Motion = 'idle';
  private audioActive = false;
  private errorActive = false;
  private override: OLEDState | null = null;
  private current: OLEDState = 'idle';
  private errorTimer: ReturnType<typeof setTimeout> | null = null;
  private stoppedTimer: ReturnType<typeof setTimeout> | null = null;

  readonly changes = new Emitter<OLEDState>();

  get state(): OLEDState {
    return this.current;
  }

  get previewOverride(): OLEDState | null {
    return this.override;
  }

  setVoiceState(state: VoiceState): void {
    this.voice = state;
    this.recompute();
  }

  /** True while speech or a sound effect is playing. */
  setAudioActive(active: boolean): void {
    this.audioActive = active;
    this.recompute();
  }

  setMoving(moving: boolean): void {
    if (this.stoppedTimer) clearTimeout(this.stoppedTimer);
    this.stoppedTimer = null;
    if (moving) {
      this.motion = 'moving';
    } else if (this.motion === 'moving') {
      this.motion = 'stopped';
      this.stoppedTimer = setTimeout(() => {
        this.motion = 'idle';
        this.recompute();
      }, STOPPED_DISPLAY_MS);
    }
    this.recompute();
  }

  flashError(): void {
    if (this.errorTimer) clearTimeout(this.errorTimer);
    this.errorActive = true;
    this.errorTimer = setTimeout(() => {
      this.errorActive = false;
      this.recompute();
    }, ERROR_FLASH_MS);
    this.recompute();
  }

  /** Forces a face for testing (Settings → OLED preview). Pass null to return to automatic. */
  setOverride(state: OLEDState | null): void {
    this.override = state;
    this.recompute();
  }

  /** Re-sends the current face (e.g. right after connecting to the car). */
  resync(): void {
    this.transmit(this.current);
  }

  private compute(): OLEDState {
    if (this.override) return this.override;
    if (this.errorActive || this.voice === 'error') return 'error';
    if (this.voice === 'listening') return 'listening';
    if (this.voice === 'processing') return 'thinking';
    if (this.voice === 'speaking' || this.audioActive) return 'speaking';
    if (this.motion === 'moving') return 'moving';
    if (this.motion === 'stopped') return 'stopped';
    return 'idle';
  }

  private recompute(): void {
    const next = this.compute();
    if (next === this.current) return;
    this.current = next;
    this.changes.emit(next);
    this.transmit(next);
  }

  private transmit(state: OLEDState): void {
    bluetoothManager.sendOLEDCommand(state).catch((error: unknown) => log.debug('OLED send failed', error));
  }
}

export const oledService = new OledService();
