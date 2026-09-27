/**
 * Offline, deterministic intent rules. They run before the AI so common
 * commands ("go forward", "stop", "make a cow sound") are instant, work
 * without internet, and can't be misread by a model.
 *
 * Returns null when unsure — the router then asks the AI.
 */
import { SAFETY_CONFIG } from '@/config/safetyConfig';
import type { SoundId } from '@/types/audio';
import type { MovementCommand } from '@/types/commands';

export type LocalIntent =
  | { intent: 'CAR_COMMAND'; command: MovementCommand; speed?: number; duration?: number }
  | { intent: 'SOUND_REQUEST'; sound: SoundId };

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, half: 0.5,
};

/** Questions about movement ("why do cars go forward?") are not commands. */
const QUESTION_START = /^(why|what|how|who|when|where|which|explain|tell me about|are you|is it|is the|do you|does)\b/;

const STOP = /\b(stop|halt|freeze|brake|stay still|don'?t move)\b/;
const MOVE_VERB = /\b(go|move|drive|head|roll|run|come|turn|rotate|spin|steer|reverse|back up)\b/;

const DIRECTIONS: { command: Exclude<MovementCommand, 'stop'>; pattern: RegExp }[] = [
  { command: 'backward', pattern: /\b(backwards?|reverse|back up|go back|move back|drive back)\b/ },
  { command: 'forward', pattern: /\b(forwards?|ahead|straight)\b/ },
  { command: 'left', pattern: /\bleft\b/ },
  { command: 'right', pattern: /\bright\b/ },
];

const SOUNDS: { sound: SoundId; pattern: RegExp; onomatopoeia?: RegExp }[] = [
  { sound: 'robot', pattern: /\b(robot (sound|noise|voice|beep)s?|beep boop|beep bop|sound like a robot)\b/ },
  { sound: 'cow', pattern: /\bcows?\b/, onomatopoeia: /\bmo+\b/ },
  { sound: 'dog', pattern: /\b(dogs?|puppy|puppies)\b/, onomatopoeia: /\b(woof|bark)\b/ },
  { sound: 'cat', pattern: /\b(cats?|kitty|kitten)\b/, onomatopoeia: /\b(meow|miaow)\b/ },
  { sound: 'lion', pattern: /\blions?\b/, onomatopoeia: /\broar\b/ },
  { sound: 'laugh', pattern: /\b(laugh|laughing|giggle)\b/, onomatopoeia: /\b(ha ?ha|hehe)\b/ },
  { sound: 'beep', pattern: /\b(beep|honk|horn)\b/, onomatopoeia: /\b(beep|honk)\b/ },
];
/** A named animal only counts as a sound request in a clearly sound-y phrase. */
const SOUND_CONTEXT = /\b(sound|noise|imitate|pretend|like a)\b|^(please )?(make|play|do|give me)\b|\b(can|could) you (make|play|do)\b/;
/** Words ignored when deciding whether an utterance is just a direction ("forward please"). */
const FILLER = new Set(['please', 'now', 'robo', 'hey', 'ok', 'okay', 'the', 'car', 'go']);

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9%.' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isQuestion(text: string): boolean {
  return QUESTION_START.test(text);
}

function parseSpeed(text: string): number | undefined {
  const percent = text.match(/(\d{1,3})\s*(%|percent)/) ?? text.match(/\bspeed (?:of |to )?(\d{1,3})\b/);
  if (percent?.[1]) return Number(percent[1]);
  if (/\b(full speed|max(imum)? speed|as fast as)\b/.test(text)) return SAFETY_CONFIG.HARD_MAX_SPEED;
  if (/\b(fast|quick(ly)?|zoom)\b/.test(text)) return 80;
  if (/\b(slow(ly)?|gently|careful(ly)?)\b/.test(text)) return 30;
  return undefined;
}

function parseDuration(text: string): number | undefined {
  const ms = text.match(/(\d+)\s*(ms|milliseconds?)\b/);
  if (ms?.[1]) return Number(ms[1]);
  const seconds = text.match(/(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|half a)\s*(s|secs?|seconds?)\b/);
  if (seconds?.[1]) {
    const word = seconds[1] === 'half a' ? 'half' : seconds[1];
    const value = NUMBER_WORDS[word] ?? Number(word);
    if (Number.isFinite(value)) return Math.round(value * 1000);
  }
  if (/\b(a (little|bit)|a tiny bit|a little bit)\b/.test(text)) return 1000;
  return undefined;
}

const HANDS_FREE_EXIT =
  /^(please )?(stop listening|stop hands ?free|hands ?free off|turn off hands ?free|go to sleep|good ?bye|bye( bye)?|that's all|thats all)( robo| now| please)*$/;

/** "Stop listening", "goodbye robo"… ends hands-free mode (checked before the car's "stop"). */
export function isHandsFreeExit(rawText: string): boolean {
  return HANDS_FREE_EXIT.test(normalize(rawText).replace(/\.$/, ''));
}

/** True when the utterance explicitly asks for movement (used to gate AI-proposed moves). */
export function mentionsMovement(rawText: string): boolean {
  const text = normalize(rawText);
  if (isQuestion(text)) return false;
  return MOVE_VERB.test(text) || DIRECTIONS.some((d) => d.pattern.test(text)) || STOP.test(text);
}

export function parseLocalIntent(rawText: string): LocalIntent | null {
  const text = normalize(rawText);
  if (!text || isQuestion(text)) return null;
  const words = text.split(' ');

  // Stop always wins: "stop!", "stop the car", "please stop turning left".
  if (STOP.test(text)) return { intent: 'CAR_COMMAND', command: 'stop' };

  // Sounds before movement so "make a robot sound" isn't read as a move.
  for (const { sound, pattern, onomatopoeia } of SOUNDS) {
    const namedWithContext = pattern.test(text) && SOUND_CONTEXT.test(text);
    const shortOnomatopoeia = onomatopoeia !== undefined && onomatopoeia.test(text) && words.length <= 4;
    const robotPhrase = sound === 'robot' && pattern.test(text);
    if (namedWithContext || shortOnomatopoeia || robotPhrase) return { intent: 'SOUND_REQUEST', sound };
  }

  // Movement needs a verb ("go left") or a bare direction ("left", "forward please").
  const direction = DIRECTIONS.find((d) => d.pattern.test(text));
  if (!direction) return null;
  const hasVerb = MOVE_VERB.test(text);
  const meaningful = words.filter((w) => !FILLER.has(w));
  const isBare = meaningful.length === 1 && direction.pattern.test(meaningful[0] ?? '');
  if (!hasVerb && !isBare) return null;

  return {
    intent: 'CAR_COMMAND',
    command: direction.command,
    speed: parseSpeed(text),
    duration: parseDuration(text),
  };
}
