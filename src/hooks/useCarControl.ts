import * as Haptics from 'expo-haptics';
import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { MovementCommand } from '@/types/commands';
import { carController } from '@/services/car/carController';
import { useAppStore } from '@/store/appStore';
import { errorMessage } from '@/utils/async';

function haptic(style: Haptics.ImpactFeedbackStyle) {
  Haptics.impactAsync(style).catch(() => undefined);
}

/** Manual driving: hold-to-drive arrows, speed, and the emergency stop. */
export function useCarControl() {
  const state = useAppStore(
    useShallow((s) => ({
      speed: s.speed,
      speedLimit: s.speedLimit,
      currentCommand: s.currentCommand,
      carStatus: s.carStatus,
    })),
  );

  const press = useCallback((direction: Exclude<MovementCommand, 'stop'>) => {
    haptic(Haptics.ImpactFeedbackStyle.Light);
    const { speed } = useAppStore.getState();
    carController.driveManual(direction, speed).catch((error: unknown) => {
      useAppStore.getState().showNotice(errorMessage(error), 'error');
    });
  }, []);

  const release = useCallback(() => {
    void carController.stop('manual');
  }, []);

  const emergencyStop = useCallback(() => {
    haptic(Haptics.ImpactFeedbackStyle.Heavy);
    void carController.stop('manual');
  }, []);

  const setSpeed = useCallback((value: number) => {
    const { speedLimit } = useAppStore.getState();
    const speed = Math.max(0, Math.min(speedLimit, Math.round(value)));
    useAppStore.getState().set({ speed });
    void carController.updateSpeed(speed);
  }, []);

  return { ...state, press, release, emergencyStop, setSpeed };
}
