/**
 * Wires services to the global store and applies app-wide safety rules.
 * Called once from the root layout. Returns a cleanup function.
 *
 * Safety rules implemented here:
 *   - Link lost → local drive timers are cleared immediately; the firmware
 *     watchdog stops the motors because keep-alives stop arriving.
 *   - Newly connected → an explicit stop is sent first so the car starts idle.
 *   - App backgrounded → the car is stopped, voice (incl. hands-free) is cancelled.
 */
import { AppState, type AppStateStatus } from 'react-native';

import { AI_ENV } from '@/config/aiConfig';
import { SAFETY_CONFIG } from '@/config/safetyConfig';
import { aiService } from '@/services/ai/AIService';
import { credentials } from '@/services/ai/credentials';
import { audioService } from '@/services/audio/audioService';
import { assistantService } from '@/services/assistant/assistantService';
import { bluetoothManager } from '@/services/bluetooth/bluetoothManager';
import { carController } from '@/services/car/carController';
import { oledService } from '@/services/oled/oledService';
import { DEFAULT_VOICE_SETTINGS, voiceService } from '@/services/voice/voiceService';
import type { Unsubscribe } from '@/utils/emitter';
import { createLogger } from '@/utils/logger';
import { useAppStore, type AppState as StoreState } from './appStore';
import { loadSettings, saveSettings, type PersistedSettings } from './settingsStorage';

const log = createLogger('Bindings');
const SAVE_DEBOUNCE_MS = 400;

function pickPersisted(state: StoreState): PersistedSettings {
  return {
    // Only remember the provider if the user picked one; otherwise follow .env.
    aiProvider: state.aiProviderChosen ? state.aiProvider : null,
    aiModels: state.aiModels,
    voiceSettings: state.voiceSettings,
    speed: state.speed,
    speedLimit: state.speedLimit,
    autoReconnect: state.autoReconnect,
    audioOutput: state.audioOutput,
  };
}

/** Pushes settings from the store into the services that use them. */
function applySettingsToServices(state: StoreState): void {
  aiService.setActiveProvider(state.aiProvider);
  aiService.setModel('openrouter', state.aiModels.openrouter);
  aiService.setModel('groq', state.aiModels.groq);
  voiceService.settings = state.voiceSettings;
  carController.setSpeedLimit(state.speedLimit);
  bluetoothManager.setAutoReconnect(state.autoReconnect);
  audioService.setPreferredOutput(state.audioOutput);
}

export function refreshKeySources(): void {
  useAppStore.getState().set({
    keySources: { openrouter: credentials.keySource('openrouter'), groq: credentials.keySource('groq') },
  });
}

export function initializeApp(): Unsubscribe {
  const store = useAppStore.getState();
  const cleanups: Unsubscribe[] = [];

  // --- Bluetooth -----------------------------------------------------------
  bluetoothManager.initialize();
  store.set({ adapterState: bluetoothManager.isBluetoothAvailable() ? 'unknown' : 'unavailable' });

  cleanups.push(
    bluetoothManager.subscribeToAdapterState((adapterState) => {
      useAppStore.getState().set({ adapterState });
      if (adapterState === 'poweredOff' && bluetoothManager.isConnected()) carController.halt();
    }),

    bluetoothManager.subscribeToConnection(({ state, device, error }) => {
      const s = useAppStore.getState();
      const wasConnected = s.connectionState === 'connected';
      s.set({ connectionState: state, connectedDevice: device, carSpeakerAvailable: bluetoothManager.canPlayAudioOnCar() });

      if (state === 'connected') {
        void carController.stop('safety');
        oledService.resync();
        s.showNotice(`Connected to ${device?.name ?? 'car'}`, 'success');
      } else if (wasConnected) {
        // Lost or closed the link while it was up: stop driving locally.
        carController.halt();
        if (state === 'reconnecting') s.showNotice('Car disconnected — stopped. Reconnecting…', 'error');
        else if (error) s.showNotice(`${error.userMessage} The car was stopped.`, 'error');
      } else if (state === 'disconnected' && error && s.connectionState !== 'connecting') {
        s.showNotice(error.userMessage, 'error');
      }
    }),

    bluetoothManager.subscribeToCarStatus((carStatus) => {
      useAppStore.getState().set({ carStatus });
    }),
  );

  // --- Car -----------------------------------------------------------------
  cleanups.push(
    carController.commandChanges.subscribe((currentCommand) => {
      useAppStore.getState().set({ currentCommand });
      oledService.setMoving(currentCommand !== null && currentCommand.command !== 'stop');
    }),
    carController.errors.subscribe((message) => useAppStore.getState().showNotice(message, 'error')),
  );

  // --- OLED / voice / audio -------------------------------------------------
  cleanups.push(
    oledService.changes.subscribe((oledState) => useAppStore.getState().set({ oledState })),
    voiceService.changes.subscribe(({ state, error }) => {
      useAppStore.getState().set({ voiceState: state, voiceError: error });
      oledService.setVoiceState(state);
    }),
    voiceService.partialTranscript.subscribe((partialTranscript) => useAppStore.getState().set({ partialTranscript })),
    audioService.activity.subscribe((kind) => oledService.setAudioActive(kind !== null)),
  );
  store.set({ speechRecognitionAvailable: voiceService.isRecognitionAvailable() });

  // --- App lifecycle safety ------------------------------------------------
  const appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
    if (next === 'background') {
      void carController.stop('safety');
      assistantService.cancel();
    }
  });
  cleanups.push(() => appStateSub.remove());

  // --- Settings: load, apply, then persist on change -------------------------
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const defaults: PersistedSettings = {
    aiProvider: null,
    aiModels: { openrouter: '', groq: '' },
    voiceSettings: DEFAULT_VOICE_SETTINGS,
    speed: SAFETY_CONFIG.DEFAULT_SPEED,
    speedLimit: SAFETY_CONFIG.DEFAULT_SPEED_LIMIT,
    autoReconnect: true,
    audioOutput: 'esp32',
  };

  void (async () => {
    await credentials.load();
    refreshKeySources();
    const settings = await loadSettings(defaults);
    useAppStore.getState().set({
      ...settings,
      aiProvider: settings.aiProvider ?? AI_ENV.provider,
      aiProviderChosen: settings.aiProvider !== null,
      settingsLoaded: true,
    });
    applySettingsToServices(useAppStore.getState());
    log.info('Ready', { provider: useAppStore.getState().aiProvider, bluetooth: bluetoothManager.isBluetoothAvailable() });
  })();

  const unsubscribeStore = useAppStore.subscribe((state, previous) => {
    if (!state.settingsLoaded) return;
    const next = pickPersisted(state);
    const prev = pickPersisted(previous);
    if (JSON.stringify(next) === JSON.stringify(prev)) return;
    applySettingsToServices(state);
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveSettings(next), SAVE_DEBOUNCE_MS);
  });
  cleanups.push(unsubscribeStore, () => {
    if (saveTimer) clearTimeout(saveTimer);
  });

  return () => cleanups.forEach((cleanup) => cleanup());
}
