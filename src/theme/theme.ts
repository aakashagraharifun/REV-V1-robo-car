/** Dark, high-contrast palette with a friendly robot accent. */
export const colors = {
  background: '#0B1020',
  surface: '#151B2E',
  surfaceRaised: '#1E2640',
  border: '#2A3456',
  primary: '#4FD1FF',
  primaryDim: '#1B4D66',
  accent: '#8B7CFF',
  success: '#3DDC97',
  warning: '#FFC857',
  danger: '#FF4D6D',
  dangerDim: '#5C1A2A',
  text: '#F4F6FF',
  textMuted: '#9AA4C7',
  textDim: '#5F6A8F',
  oledBackground: '#000000',
  oledPixel: '#7FE7FF',
  onPrimary: '#04121A',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 10, md: 16, lg: 24, pill: 999 } as const;

export const typography = {
  title: { fontSize: 28, fontWeight: '800' as const, color: colors.text },
  heading: { fontSize: 18, fontWeight: '700' as const, color: colors.text },
  body: { fontSize: 16, fontWeight: '400' as const, color: colors.text },
  label: { fontSize: 13, fontWeight: '600' as const, color: colors.textMuted, letterSpacing: 0.6 },
  caption: { fontSize: 12, fontWeight: '500' as const, color: colors.textMuted },
} as const;

/** Minimum touch target (dp). */
export const TOUCH_TARGET = 56;
