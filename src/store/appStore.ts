/**
 * Global app state (Zustand). Services never import this — they emit events
 * and `store/bindings.ts` copies them in. Screens read from here and call
 * services through hooks. API keys are deliberately NOT stored here.
 */
import { create } from 'zustand';

import { AI_ENV } from '@/config/aiConfig';
import { SAFETY_CONFIG } from '@/config/safetyConfig';
import type { AIProviderId, ChatMessage } from '@/types/ai';
import type { BluetoothAdapterState, BluetoothDevice, ConnectionState } from '@/types/bluetooth';
import type { CarCommand, CarStatus } from '@/types/commands';
import type { AudioOutputTarget } from '@/types/audio';
import type { OLEDState } from '@/types/oled';
import type { VoiceSettings, VoiceState } from '@/types/voice';
import type { KeySource } from '@/services/ai/credentials';
import { DEFAULT_VOICE_SETTINGS } from '@/services/voice/voiceService';
import { createId } from '@/utils/async';

export type NoticeTone = 'info' | 'success' | 'error';
export interface Notice {
  id: string;
  message: string;
  tone: NoticeTone;
}

const MAX_CONVERSATION = 100;

export interface AppState {
  // Bluetooth
  adapterState: BluetoothAdapterState;
  connectionState: ConnectionState;
  connectedDevice: BluetoothDevice | null;
  isScanning: boolean;
  discoveredDevices: BluetoothDevice[];
  autoReconnect: boolean;

  // Car
  carStatus: CarStatus;
  currentCommand: CarCommand | null;
  /** Speed selected on the Control screen (0–100). */
  speed: number;
  /** User speed limit (Settings). */
  speedLimit: number;

  // OLED
  oledState: OLEDState;
  oledOverride: OLEDState | null;

  // Voice
  voiceState: VoiceState;
  voiceError: string | null;
  partialTranscript: string;
  voiceSettings: VoiceSettings;
  speechRecognitionAvailable: boolean;
  /** Continuous voice control is on (listen → answer → listen…). */
  handsFree: boolean;

  // Audio output
  /** Where the user wants Robo's voice and sounds (Settings). */
  audioOutput: AudioOutputTarget;
  /** The connected car has a speaker (audio characteristic). */
  carSpeakerAvailable: boolean;

  // AI
  conversation: ChatMessage[];
  aiProvider: AIProviderId;
  /** True once the user picks a provider in Settings (then it overrides .env). */
  aiProviderChosen: boolean;
  /** Model overrides from Settings ('' = use EXPO_PUBLIC_*_MODEL). */
  aiModels: Record<AIProviderId, string>;
  keySources: Record<AIProviderId, KeySource>;

  // UI
  notice: Notice | null;
  settingsLoaded: boolean;

  // Actions
  set: (partial: Partial<AppState>) => void;
  addMessage: (message: Omit<ChatMessage, 'id' | 'createdAt'>) => ChatMessage;
  clearConversation: () => void;
  showNotice: (message: string, tone?: NoticeTone) => void;
  dismissNotice: () => void;
}

export const INITIAL_CAR_STATUS: CarStatus = {
  state: 'idle',
  command: null,
  speed: 0,
  battery: null,
  updatedAt: 0,
  origin: 'demo',
};

export const useAppStore = create<AppState>()((set) => ({
  adapterState: 'unknown',
  connectionState: 'disconnected',
  connectedDevice: null,
  isScanning: false,
  discoveredDevices: [],
  autoReconnect: true,

  carStatus: INITIAL_CAR_STATUS,
  currentCommand: null,
  speed: SAFETY_CONFIG.DEFAULT_SPEED,
  speedLimit: SAFETY_CONFIG.DEFAULT_SPEED_LIMIT,

  oledState: 'idle',
  oledOverride: null,

  voiceState: 'idle',
  voiceError: null,
  partialTranscript: '',
  voiceSettings: DEFAULT_VOICE_SETTINGS,
  speechRecognitionAvailable: false,
  handsFree: false,

  audioOutput: 'esp32',
  carSpeakerAvailable: false,

  conversation: [],
  aiProvider: AI_ENV.provider,
  aiProviderChosen: false,
  aiModels: { openrouter: '', groq: '' },
  keySources: { openrouter: 'none', groq: 'none' },

  notice: null,
  settingsLoaded: false,

  set: (partial) => set(partial),

  addMessage: (message) => {
    const full: ChatMessage = { ...message, id: createId('msg'), createdAt: Date.now() };
    set((state) => ({ conversation: [...state.conversation, full].slice(-MAX_CONVERSATION) }));
    return full;
  },

  clearConversation: () => set({ conversation: [] }),

  showNotice: (message, tone = 'info') => set({ notice: { id: createId('notice'), message, tone } }),

  dismissNotice: () => set({ notice: null }),
}));
