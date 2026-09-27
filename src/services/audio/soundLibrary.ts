/**
 * Bundled soundboard clips (16-bit PCM WAV — the car speaker path decodes
 * them). Animals and laugh are real recordings (scripts/fetch-real-sounds.mjs,
 * licences in assets/sounds/CREDITS.md); robot and beep are synthesized
 * (scripts/generate-sounds.mjs).
 */
import type { SoundId } from '@/types/audio';

export interface SoundDefinition {
  id: SoundId;
  label: string;
  emoji: string;
  /** What Robo says when playing it. */
  caption: string;
  source: number;
}

export const SOUND_LIBRARY: Record<SoundId, SoundDefinition> = {
  cow: { id: 'cow', label: 'Cow', emoji: '🐮', caption: 'Moooo! Here is my cow.', source: require('../../../assets/sounds/cow.wav') },
  dog: { id: 'dog', label: 'Dog', emoji: '🐶', caption: 'Woof woof! Here is my dog.', source: require('../../../assets/sounds/dog.wav') },
  cat: { id: 'cat', label: 'Cat', emoji: '🐱', caption: 'Meow! Here is my cat.', source: require('../../../assets/sounds/cat.wav') },
  lion: { id: 'lion', label: 'Lion', emoji: '🦁', caption: 'Roooar! Here is my lion.', source: require('../../../assets/sounds/lion.wav') },
  robot: { id: 'robot', label: 'Robot', emoji: '🤖', caption: 'Beep boop! That is how robots talk.', source: require('../../../assets/sounds/robot.wav') },
  laugh: { id: 'laugh', label: 'Laugh', emoji: '😄', caption: 'Ha ha ha!', source: require('../../../assets/sounds/laugh.wav') },
  beep: { id: 'beep', label: 'Beep', emoji: '🔔', caption: 'Beep beep!', source: require('../../../assets/sounds/beep.wav') },
};
