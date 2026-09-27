import { isHandsFreeExit, mentionsMovement, parseLocalIntent } from '../localIntentParser';

describe('parseLocalIntent — car commands', () => {
  it.each([
    ['Go forward', 'forward'],
    ['Turn left', 'left'],
    ['turn right', 'right'],
    ['go back', 'backward'],
    ['Reverse!', 'backward'],
    ['forward please', 'forward'],
    ['right', 'right'],
    ['Stop the car', 'stop'],
    ['STOP!', 'stop'],
    ['please stop turning left', 'stop'],
  ])('"%s" → %s', (text, command) => {
    expect(parseLocalIntent(text)).toMatchObject({ intent: 'CAR_COMMAND', command });
  });

  it('extracts speed and duration', () => {
    expect(parseLocalIntent('go forward for 3 seconds at 70 percent')).toEqual({
      intent: 'CAR_COMMAND',
      command: 'forward',
      speed: 70,
      duration: 3000,
    });
    expect(parseLocalIntent('turn right slowly')).toMatchObject({ command: 'right', speed: 30 });
    expect(parseLocalIntent('drive forward for two seconds')).toMatchObject({ duration: 2000 });
    expect(parseLocalIntent('move ahead a little')).toMatchObject({ command: 'forward', duration: 1000 });
  });

  it.each([
    'Why is the moon round?',
    'Tell me a joke',
    'why do cars go forward?',
    "that's right",
    'can you tell me about cats',
    'What is left in the box?',
  ])('does not treat "%s" as a command', (text) => {
    expect(parseLocalIntent(text)).toBeNull();
  });
});

describe('parseLocalIntent — sounds', () => {
  it.each([
    ['Make a cow sound', 'cow'],
    ['moo', 'cow'],
    ['woof woof', 'dog'],
    ['can you roar like a lion', 'lion'],
    ['make a robot sound', 'robot'],
    ['beep boop', 'robot'],
    ['play the cat noise', 'cat'],
    ['honk', 'beep'],
  ])('"%s" → %s', (text, sound) => {
    expect(parseLocalIntent(text)).toEqual({ intent: 'SOUND_REQUEST', sound });
  });
});

describe('mentionsMovement', () => {
  it('is true only for explicit movement requests', () => {
    expect(mentionsMovement('please drive forward')).toBe(true);
    expect(mentionsMovement('could you zoom ahead')).toBe(true);
    expect(mentionsMovement('tell me a joke')).toBe(false);
    expect(mentionsMovement('I feel sad today')).toBe(false);
    expect(mentionsMovement('why do cars move?')).toBe(false);
  });
});

describe('isHandsFreeExit', () => {
  it.each(['Stop listening', 'stop listening robo', 'Goodbye Robo.', 'bye bye', 'go to sleep', "That's all", 'turn off hands-free'])(
    'ends hands-free for %p',
    (text) => {
      expect(isHandsFreeExit(text)).toBe(true);
    },
  );

  it.each(['stop', 'stop the car', 'say goodbye to grandma', 'why do we sleep', 'go forward'])('does not end hands-free for %p', (text) => {
    expect(isHandsFreeExit(text)).toBe(false);
  });
});
