/**
 * The companion pipeline — the one place that connects the pieces:
 *
 *   voice/text → intent router → (car | sound | AI reply) → chat + speech
 *
 * Robo only reports an action after the app has actually performed it.
 *
 * Hands-free mode ("fully speech controlled"): listen → handle → speak →
 * listen again, until the user says "stop listening", turns it off, the app
 * goes to the background, or nothing is said for a while.
 */
import type { CarCommand } from '@/types/commands';
import type { IntentType } from '@/types/ai';
import { AIError } from '@/services/ai/AIProvider';
import { AudioError, audioService } from '@/services/audio/audioService';
import { SOUND_LIBRARY } from '@/services/audio/soundLibrary';
import { bluetoothManager } from '@/services/bluetooth/bluetoothManager';
import { BluetoothError } from '@/services/bluetooth/bluetoothErrors';
import { carController } from '@/services/car/carController';
import { routeUserInput } from '@/services/intent/intentRouter';
import { isHandsFreeExit } from '@/services/intent/localIntentParser';
import { voiceService } from '@/services/voice/voiceService';
import { useAppStore } from '@/store/appStore';
import type { SpeechErrorCode } from '@/types/voice';
import { sleep } from '@/utils/async';
import { createLogger } from '@/utils/logger';

const log = createLogger('Assistant');

/** Hands-free turns itself off after this long without hearing anything. */
const HANDS_FREE_IDLE_MS = 2 * 60_000;
/** Consecutive recognizer failures (network, busy…) before hands-free gives up. */
const HANDS_FREE_MAX_FAILURES = 4;
/** Errors retrying can't fix. */
const FATAL_SPEECH_ERRORS: SpeechErrorCode[] = ['unavailable', 'permission_denied'];

const DIRECTION_TEXT: Record<Exclude<CarCommand['command'], 'stop'>, string> = {
  forward: 'Driving forward',
  backward: 'Backing up',
  left: 'Turning left',
  right: 'Turning right',
};

function describeCommand(command: CarCommand): { text: string; spoken: string } {
  if (command.command === 'stop') return { text: 'Stopped! 🛑', spoken: 'Stopped!' };
  const base = DIRECTION_TEXT[command.command];
  const seconds = command.durationMs ? ` for ${(command.durationMs / 1000).toFixed(1).replace(/\.0$/, '')}s` : '';
  return { text: `${base} at ${command.speed}%${seconds}.`, spoken: `${base}!` };
}

function userMessageFor(error: unknown): string {
  if (error instanceof AIError || error instanceof BluetoothError || error instanceof AudioError) {
    return error.userMessage;
  }
  return 'Oops, something went wrong. Please try again.';
}

class AssistantService {
  private inFlight: AbortController | null = null;
  /** Bumped to end the running hands-free loop. */
  private handsFreeSession = 0;

  get handsFree(): boolean {
    return useAppStore.getState().handsFree;
  }

  /** Mic button: listen, then handle whatever was said. */
  async talk(): Promise<void> {
    const store = useAppStore.getState();
    if (store.voiceState === 'listening') {
      voiceService.finishListening();
      return;
    }
    this.cancel();
    const outcome = await voiceService.listen();
    if (outcome.kind === 'heard') await this.handleInput(outcome.text);
  }

  /** Turns continuous voice control on or off. */
  setHandsFree(enabled: boolean): void {
    if (enabled === this.handsFree) return;
    this.handsFreeSession++;
    useAppStore.getState().set({ handsFree: enabled });
    if (enabled) {
      this.inFlight?.abort();
      voiceService.cancel();
      void this.runHandsFree(this.handsFreeSession);
    } else {
      voiceService.cancel();
    }
  }

  private async runHandsFree(session: number): Promise<void> {
    const active = () => session === this.handsFreeSession;
    let lastHeard = Date.now();
    let failures = 0;
    const stop = (notice?: string) => {
      if (!active()) return;
      this.setHandsFree(false);
      if (notice) useAppStore.getState().showNotice(notice, 'info');
    };

    while (active()) {
      // Never listen while Robo is still talking or playing a sound.
      while (audioService.isBusy && active()) await sleep(100);
      if (!active()) return;

      const outcome = await voiceService.listen({ quiet: true });
      if (!active()) return;

      switch (outcome.kind) {
        case 'heard':
          lastHeard = Date.now();
          failures = 0;
          if (isHandsFreeExit(outcome.text)) {
            useAppStore.getState().addMessage({ author: 'user', text: outcome.text, kind: 'text' });
            // Say goodbye first: turning hands-free off stops all audio.
            await this.reply('Okay, I’ll stop listening. Tap the mic when you need me!', 'GENERAL_CONVERSATION', 'text');
            stop();
            return;
          }
          await this.handleInput(outcome.text);
          break;
        case 'silence':
          if (Date.now() - lastHeard > HANDS_FREE_IDLE_MS) {
            stop('Hands-free paused after 2 minutes of quiet.');
            return;
          }
          await sleep(200);
          break;
        case 'cancelled':
          await sleep(200);
          break;
        case 'failed':
          failures++;
          if (FATAL_SPEECH_ERRORS.includes(outcome.code) || failures >= HANDS_FREE_MAX_FAILURES) {
            stop('Hands-free stopped: voice input isn’t working right now.');
            return;
          }
          await sleep(1_000 * failures);
          break;
      }
    }
  }

  /** Handles one user request from voice or the text box. */
  async handleInput(rawText: string): Promise<void> {
    const text = rawText.trim();
    if (!text) return;

    this.inFlight?.abort();
    const controller = new AbortController();
    this.inFlight = controller;

    const store = useAppStore.getState();
    const history = store.conversation;
    store.addMessage({ author: 'user', text, kind: 'text' });
    voiceService.markProcessing();

    try {
      const routed = await routeUserInput(text, {
        history,
        speedLimit: store.speedLimit,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;

      switch (routed.type) {
        case 'CAR_COMMAND': {
          await carController.drive(routed.command);
          const { text: reply, spoken } = describeCommand(routed.command);
          const suffix = bluetoothManager.isDemoMode() ? ' (Demo car)' : '';
          await this.reply(reply + suffix, 'CAR_COMMAND', 'action', spoken);
          break;
        }
        case 'SOUND_REQUEST': {
          const sound = SOUND_LIBRARY[routed.sound];
          this.post(`${sound.emoji} ${sound.caption}`, 'SOUND_REQUEST', 'action');
          voiceService.markIdle();
          await audioService.playSound(routed.sound);
          break;
        }
        case 'AI_QUESTION':
        case 'GENERAL_CONVERSATION':
          await this.reply(routed.response, routed.type, 'text');
          break;
        case 'REJECTED':
          await this.reply(routed.reason, routed.intent, 'text');
          break;
      }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof AIError && error.code === 'aborted')) return;
      log.warn('Request failed', error);
      const message = userMessageFor(error);
      this.post(message, undefined, 'error');
      voiceService.fail(message);
      return;
    } finally {
      if (this.inFlight === controller) this.inFlight = null;
    }
  }

  /** Stops listening, thinking and talking, and ends hands-free. Does not stop the car (use STOP for that). */
  cancel(): void {
    if (this.handsFree) this.setHandsFree(false);
    this.inFlight?.abort();
    this.inFlight = null;
    voiceService.cancel();
  }

  private post(text: string, intent: IntentType | undefined, kind: 'text' | 'action' | 'error'): void {
    useAppStore.getState().addMessage({ author: 'robo', text, intent, kind });
  }

  private async reply(text: string, intent: IntentType, kind: 'text' | 'action', spoken: string = text): Promise<void> {
    this.post(text, intent, kind);
    // Hands-free is a spoken conversation, so always answer out loud there.
    if (useAppStore.getState().voiceSettings.autoSpeak || this.handsFree) {
      await voiceService.speak(spoken);
    } else {
      voiceService.markIdle();
    }
  }
}

export const assistantService = new AssistantService();
