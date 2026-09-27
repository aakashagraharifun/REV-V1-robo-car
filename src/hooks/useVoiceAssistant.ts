import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { assistantService } from '@/services/assistant/assistantService';
import { useAppStore } from '@/store/appStore';

/** Talk/type to Robo. */
export function useVoiceAssistant() {
  const state = useAppStore(
    useShallow((s) => ({
      voiceState: s.voiceState,
      voiceError: s.voiceError,
      partialTranscript: s.partialTranscript,
      conversation: s.conversation,
      speechRecognitionAvailable: s.speechRecognitionAvailable,
      handsFree: s.handsFree,
    })),
  );

  const talk = useCallback(() => {
    void assistantService.talk();
  }, []);

  const sendText = useCallback((text: string) => {
    void assistantService.handleInput(text);
  }, []);

  const cancel = useCallback(() => assistantService.cancel(), []);

  /**
   * Mic button behaviour: talk → (tap again) finish listening; tap while
   * thinking/speaking = stop. In hands-free mode any tap turns hands-free off.
   */
  const micPress = useCallback(() => {
    const { voiceState, handsFree } = useAppStore.getState();
    if (handsFree) assistantService.setHandsFree(false);
    else if (voiceState === 'processing' || voiceState === 'speaking') assistantService.cancel();
    else void assistantService.talk();
  }, []);

  const setHandsFree = useCallback((enabled: boolean) => assistantService.setHandsFree(enabled), []);

  const clearConversation = useCallback(() => {
    assistantService.cancel();
    useAppStore.getState().clearConversation();
  }, []);

  return { ...state, talk, micPress, sendText, cancel, clearConversation, setHandsFree };
}
