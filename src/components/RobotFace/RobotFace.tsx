/**
 * Preview of the ESP32 OLED face. Monochrome, drawn on a 128×64 grid (see
 * faceGeometry.ts) so what you see here is what the firmware should draw.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse, Line, Path, Rect } from 'react-native-svg';

import type { OLEDState } from '@/types/oled';
import { colors } from '@/theme/theme';
import { FACE, OLED_HEIGHT, OLED_WIDTH, type Box } from './faceGeometry';

const PIXEL = colors.oledPixel;
const S = FACE.stroke;

type AnimatedStyle = Animated.WithAnimatedValue<StyleProp<ViewStyle>>;

/** Renders SVG children (in OLED coordinates) inside an animatable box. */
function Part({ box, unit, style, children }: { box: Box; unit: number; style?: AnimatedStyle; children: ReactNode }) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', left: box.x * unit, top: box.y * unit, width: box.w * unit, height: box.h * unit },
        style,
      ]}
    >
      <Svg width="100%" height="100%" viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}>
        {children}
      </Svg>
    </Animated.View>
  );
}

function Eye({ box, state }: { box: Box; state: OLEDState }) {
  const { x, y, w, h } = box;
  switch (state) {
    case 'moving': // happy ^
      return <Path d={`M ${x + 2} ${y + 18} Q ${x + w / 2} ${y} ${x + w - 2} ${y + 18}`} stroke={PIXEL} strokeWidth={4} strokeLinecap="round" fill="none" />;
    case 'error': // X
      return (
        <>
          <Line x1={x + 3} y1={y + 3} x2={x + w - 3} y2={y + h - 3} stroke={PIXEL} strokeWidth={4} strokeLinecap="round" />
          <Line x1={x + w - 3} y1={y + 3} x2={x + 3} y2={y + h - 3} stroke={PIXEL} strokeWidth={4} strokeLinecap="round" />
        </>
      );
    case 'thinking': // squint, looking up
      return <Rect x={x + 3} y={y + 2} width={w - 4} height={12} rx={4} fill={PIXEL} />;
    case 'listening': // wide open with a highlight
      return (
        <>
          <Rect x={x} y={y} width={w} height={h} rx={FACE.eyeRadius} fill={PIXEL} />
          <Rect x={x + 4} y={y + 4} width={6} height={6} rx={1} fill={colors.oledBackground} />
        </>
      );
    default:
      return <Rect x={x} y={y} width={w} height={h} rx={FACE.eyeRadius} fill={PIXEL} />;
  }
}

function Mouth({ state }: { state: OLEDState }) {
  switch (state) {
    case 'listening':
      return <Circle cx={64} cy={50} r={4} stroke={PIXEL} strokeWidth={S} fill="none" />;
    case 'speaking':
      return <Ellipse cx={64} cy={50} rx={10} ry={6} fill={PIXEL} />;
    case 'moving':
      return <Path d="M 46 44 Q 64 64 82 44 Z" fill={PIXEL} />;
    case 'stopped':
      return <Line x1={53} y1={50} x2={75} y2={50} stroke={PIXEL} strokeWidth={S} strokeLinecap="round" />;
    case 'error':
      return <Path d="M 52 55 Q 64 44 76 55" stroke={PIXEL} strokeWidth={S} strokeLinecap="round" fill="none" />;
    case 'thinking':
      return null; // animated dots are drawn separately
    default:
      return <Path d="M 50 46 Q 64 58 78 46" stroke={PIXEL} strokeWidth={S} strokeLinecap="round" fill="none" />;
  }
}

function WaveBars({ box }: { box: Box }) {
  const cx = box.x + box.w / 2;
  const mid = box.y + box.h / 2;
  return (
    <>
      <Line x1={cx - 5} y1={mid - 5} x2={cx - 5} y2={mid + 5} stroke={PIXEL} strokeWidth={2.5} strokeLinecap="round" />
      <Line x1={cx} y1={mid - 11} x2={cx} y2={mid + 11} stroke={PIXEL} strokeWidth={2.5} strokeLinecap="round" />
      <Line x1={cx + 5} y1={mid - 5} x2={cx + 5} y2={mid + 5} stroke={PIXEL} strokeWidth={2.5} strokeLinecap="round" />
    </>
  );
}

const DOT_BOXES: Box[] = [
  { x: 51, y: 46, w: 8, h: 8 },
  { x: 60, y: 46, w: 8, h: 8 },
  { x: 69, y: 46, w: 8, h: 8 },
];

function loop(animation: Animated.CompositeAnimation) {
  return Animated.loop(animation);
}

function timing(value: Animated.Value, toValue: number, duration: number) {
  return Animated.timing(value, { toValue, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true });
}

interface RobotFaceProps {
  state: OLEDState;
  /** Width in dp; height is always width / 2 (plus bezel). */
  width: number;
  style?: StyleProp<ViewStyle>;
}

export function RobotFace({ state, width, style }: RobotFaceProps) {
  const bezel = Math.max(6, Math.round(width * 0.04));
  const screenWidth = width - bezel * 2;
  const unit = screenWidth / OLED_WIDTH;

  const blink = useState(() => new Animated.Value(1))[0];
  const eyeScale = useState(() => new Animated.Value(1))[0];
  const mouthScale = useState(() => new Animated.Value(1))[0];
  const bounce = useState(() => new Animated.Value(0))[0];
  const flash = useState(() => new Animated.Value(1))[0];
  const waves = useState(() => new Animated.Value(1))[0];
  const dots = useState(() => DOT_BOXES.map(() => new Animated.Value(0.25)))[0];

  useEffect(() => {
    const running: Animated.CompositeAnimation[] = [];
    const start = (a: Animated.CompositeAnimation) => {
      running.push(a);
      a.start();
    };

    // Reset between states.
    [blink, eyeScale, mouthScale, flash, waves].forEach((v) => v.setValue(1));
    bounce.setValue(0);
    dots.forEach((d) => d.setValue(0.25));

    const blinkEvery = (delay: number) =>
      start(loop(Animated.sequence([Animated.delay(delay), timing(blink, 0.1, 70), timing(blink, 1, 110)])));

    switch (state) {
      case 'idle':
      case 'stopped':
        blinkEvery(3200);
        break;
      case 'listening':
        start(loop(Animated.sequence([timing(eyeScale, 1.1, 450), timing(eyeScale, 1, 450)])));
        start(loop(Animated.sequence([timing(waves, 0.35, 260), timing(waves, 1, 260)])));
        break;
      case 'thinking':
        blinkEvery(1400);
        start(
          loop(
            Animated.stagger(
              180,
              dots.map((d) => Animated.sequence([timing(d, 1, 220), timing(d, 0.25, 320)])),
            ),
          ),
        );
        break;
      case 'speaking':
        blinkEvery(2600);
        start(
          loop(
            Animated.sequence([
              timing(mouthScale, 0.3, 120),
              timing(mouthScale, 1, 140),
              timing(mouthScale, 0.55, 100),
              timing(mouthScale, 0.9, 130),
            ]),
          ),
        );
        break;
      case 'moving':
        start(loop(Animated.sequence([timing(bounce, -1.5 * unit, 220), timing(bounce, 0, 220)])));
        break;
      case 'error':
        start(loop(Animated.sequence([timing(flash, 0.35, 280), timing(flash, 1, 280)])));
        break;
    }
    return () => running.forEach((a) => a.stop());
  }, [state, unit, blink, eyeScale, mouthScale, bounce, flash, waves, dots]);

  const eyeStyle: AnimatedStyle = { transform: [{ scaleY: blink }, { scale: eyeScale }] };

  return (
    <View
      style={[styles.bezel, { width, padding: bezel, borderRadius: bezel * 2 }, style]}
      accessibilityRole="image"
      accessibilityLabel={`Robo face: ${state}`}
    >
      <Animated.View
        style={[
          styles.screen,
          { width: screenWidth, height: (screenWidth * OLED_HEIGHT) / OLED_WIDTH, borderRadius: bezel },
          { opacity: flash, transform: [{ translateY: bounce }] },
        ]}
      >
        <Part box={FACE.leftEye} unit={unit} style={eyeStyle}>
          <Eye box={FACE.leftEye} state={state} />
        </Part>
        <Part box={FACE.rightEye} unit={unit} style={eyeStyle}>
          <Eye box={FACE.rightEye} state={state} />
        </Part>
        <Part box={FACE.mouth} unit={unit} style={{ transform: [{ scaleY: mouthScale }] }}>
          <Mouth state={state} />
        </Part>

        {state === 'thinking' &&
          DOT_BOXES.map((box, i) => (
            <Part key={box.x} box={box} unit={unit} style={{ opacity: dots[i] }}>
              <Circle cx={box.x + box.w / 2} cy={box.y + box.h / 2} r={2.5} fill={PIXEL} />
            </Part>
          ))}

        {state === 'listening' && (
          <>
            <Part box={FACE.leftWave} unit={unit} style={{ transform: [{ scaleY: waves }] }}>
              <WaveBars box={FACE.leftWave} />
            </Part>
            <Part box={FACE.rightWave} unit={unit} style={{ transform: [{ scaleY: waves }] }}>
              <WaveBars box={FACE.rightWave} />
            </Part>
          </>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  bezel: {
    backgroundColor: '#05070D',
    borderWidth: 2,
    borderColor: colors.border,
    alignSelf: 'center',
  },
  screen: {
    backgroundColor: colors.oledBackground,
    overflow: 'hidden',
  },
});
